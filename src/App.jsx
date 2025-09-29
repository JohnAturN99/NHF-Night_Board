// src/App.jsx
// Night Report Dashboard (React + Vite + Tailwind)
// Tabs:
//  - Overview: shows latest Night Report as 8 tail cards (click for details)
//  - RTS:      parse & display Daily RTS OR a Weekly RTS plan (missions before Healing)
//  - Generator:compose Night Report from HOTO + Telegram defects
//  - HOTO:     paste HOTO, tick outstanding items, move to Completed, and save
//  - Servicing: plan & track minor/major servicing (rows, color codes, D-days)
//  - Calculator: quick date projections + Eng↔AF hour tools
//
// Storage: Firestore (collection "reports", doc id = "YYYY-MM-DD")
// Auth: Google (popup with redirect fallback handled in firebase.js)

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  db,
  auth,
  onAuthStateChanged,
  signInWithGoogleSmart,
  signOut,
  completeRedirectSignIn,
} from "./firebase";

import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  deleteDoc,
} from "firebase/firestore";

/* =========================
   Settings / constants
   ========================= */
const PLACEHOLDERS = [252, 253, 260, 261, 262, 263, 265, 266];
// Use \n (not /n) to create a newline; footer uses whitespace-pre-line to render it
const APP_VERSION = "v0.0.4\nCreated by JohnAturn";

/* =========================
   Servicing meta (windows / thresholds)
   ========================= */
// Frequency/window guidance based on your notes.
// - minor: 7/14/28/56 (A/B) → due-soon = 3 days
// - major: 112/365/730/1430 → due-soon = 5% of interval (rounded up)
// - custom windows you provided override due-soon where applicable
const SERV_META = {
  "7D":     { minor: true,  freqDays: 7 },
  "14D":    { minor: true,  freqDays: 14 },
  "28D":    { minor: true,  freqDays: 28 },
  "56A":    { minor: true,  freqDays: 56, windowDays: 2 },
  "56B":    { minor: true,  freqDays: 56, windowDays: 4 },
  "112D":   { major: true,  freqDays: 112 },
  "365D":   { major: true,  freqDays: 365, windowDays: 30, recoveryDays: 5 },
  "365D+A": { major: true,               windowDays: 50, recoveryDays: 10 },
  "365D+B": { major: true,               windowDays: 60, recoveryDays: 10 },
  "Phase A":{ major: true,               windowDays: 40, recoveryDays: 5 },
  "Phase B":{ major: true,               windowDays: 50, recoveryDays: 5 },
  "Whidbey":{ major: true,               windowDays: 20, recoveryDays: 10 },
  "730D":   { major: true,  freqDays: 730 },
  "1430D":  { major: true,  freqDays: 1430 },
  "30H":    { hourly: true, hours: 30 },
  "60H":    { hourly: true, hours: 60 },
};

const SERV_TYPE_OPTIONS = [
  "7D","14D","28D","56A","56B","112D","365D","365D+A","365D+B","730D","1430D","Phase A","Phase B","Whidbey","30H","60H"
];

// Calculator fixed intervals (days)
const CALC_INTERVALS = [14, 28, 56, 112, 180, 365];

// Hours ratio
const ENG_TO_AF = 0.85; // 1 Eng hr = 0.85 AF hr

/* =========================
   Helpers (IDs, status, parsing)
   ========================= */

// Convert numeric placeholder id to code:
// 252 -> F2 ; 253 -> F3 ; 260 -> S0 ; 261 -> S1 ; etc.
function idToCode(id) {
  if (id >= 251 && id <= 259) return `F${id - 250}`;
  if (id >= 260 && id <= 269) return `S${id - 260}`;
  return String(id);
}

// Determine status color/tag from the parsed entry.
// Priority: AOG (purple) > U/S or defect/GR (red) > in-phase (orange) > recovery (blue) > serviceable (green)
function deriveStatusTag(entry) {
  const title = entry?.title || "";
  const allText = [
    entry?.title || "",
    entry?.input || "",
    entry?.etr || "",
    ...(entry?.notes || []),
  ].join(" ");

  // normalize quotes and lowercase for robust matching
  const normalized = allText.replace(/[“”‘’"']/g, "").toLowerCase();

  // Highest priority: explicit AOG anywhere
  const isAOG = /\baog\b/.test(normalized);

  // U/S can appear as "U/S" or "US" in your texts
  const isUS = /\bu\/s\b/.test(normalized) || /\bus\b/.test(normalized);

  // Defect/Rect/GR means rectification (red)
  const hasDefectOrGR =
    /\bdefect\b/.test(normalized) ||
    /\brect\b/.test(normalized) ||
    /\bgr\b/.test(normalized);

  // Phase/major servicing marker (header)
  const inPhase = /(major serv|phase\b)/i.test(title);

  // Recovery marker
  const recovery = /\b(post\s*phase\s*rcv|recovery)\b/i.test(normalized);

  if (isAOG) return "aog";                        // purple
  if (isUS || hasDefectOrGR) return "rectification"; // red
  if (inPhase) return "in-phase";                 // orange
  if (recovery) return "recovery";                // blue
  if (/\s-\s*s(\b|$)/i.test(entry.title)) return "serviceable"; // green
  return "serviceable";
}

// Map status tag to Tailwind classes
function statusToClasses(tag) {
  switch (tag) {
    case "serviceable":
      return "bg-green-50 border-green-300";
    case "rectification":
      return "bg-red-50 border-red-300";
    case "in-phase":
      return "bg-orange-50 border-orange-300";
    case "recovery":
      return "bg-blue-50 border-blue-300";
    case "aog": // NEW
      return "bg-purple-50 border-purple-300";
    default:
      return "bg-gray-50 border-gray-200";
  }
}

// Status label for the chip on card
function statusLabel(tag) {
  switch (tag) {
    case "serviceable": return "Serviceable";
    case "rectification": return "Rectification";
    case "in-phase": return "In Phase";
    case "recovery": return "Recovery";
    case "aog": return "AOG";
    default: return "No status";
  }
}

// Parse Night Report source text into a map keyed by code ("S1", "F2", ...)
function parseReport(text) {
  const lines = (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());
  const entries = {};
  let current = null;

  // Headers like "*S2 - GR", "S0  - Major Serv (...)", "*F2 - S"
  const header = /^[>*\s-]*\*?\s*([SF]\d)\s*-\s*(.+)$/i;

  for (const line of lines) {
    if (!line) continue;

    const h = header.exec(line);
    if (h) {
      const code = h[1].toUpperCase();
      const tail = h[2].trim();
      entries[code] = {
        code,
        title: `${code} - ${tail}`,
        input: "",
        etr: "",
        notes: [],
      };
      current = code;
      continue;
    }

    if (!current) continue;

    // Known fields
    const mInput = /^Input:\s*(.+)$/i.exec(line);
    if (mInput) {
      entries[current].input = mInput[1].trim();
      continue;
    }
    const mEtr = /^ETR:\s*(.+)$/i.exec(line);
    if (mEtr) {
      entries[current].etr = mEtr[1].trim();
      continue;
    }

    // Bulleted notes or "Requirements" marker
    if (/^>/.test(line)) {
      entries[current].notes.push(line.replace(/^>\s*/, ""));
      continue;
    }
    if (/^-/.test(line)) {
      entries[current].notes.push(line.replace(/^-+\s*/, ""));
      continue;
    }
    if (/^Requirements$/i.test(line)) {
      entries[current].notes.push("Requirements:");
      continue;
    }
  }

  // Promote ETR from notes (if present) and attach status tag
  Object.keys(entries).forEach((k) => {
    const e = entries[k];
    if (!e.etr && Array.isArray(e.notes)) {
      const ln = e.notes.find((n) => /^ETR\s*:/i.test(n));
      if (ln) e.etr = ln.replace(/^ETR\s*:\s*/i, "").trim();
    }
    e.tag = deriveStatusTag(e);
  });

  return entries;
}

// Utilities for date formatting
function getTodayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayHeader(iso) {
  try {
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDate();
    const mon = d.toLocaleString(undefined, { month: "short" });
    const wk = d.toLocaleString(undefined, { weekday: "short" });
    return `${day} ${mon} (${wk})`;
  } catch {
    return iso;
  }
}

/* =========================
   Telegram defects parsing
   ========================= */
function parseTelegramDefects(text) {
  const blocks = (text || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const byCode = {};
  let current = null;
  const pushCurrent = () => { if (current && current.code) byCode[current.code] = current; };

  for (const b of blocks) {
    const codeLine = b.match(/^\s*([FS]\d)\s*$/im);
    if (codeLine) { pushCurrent(); current = { code: codeLine[1].toUpperCase(), lines: [] }; }
    if (!current) continue;
    current.lines.push(b);
  }
  pushCurrent();

  Object.values(byCode).forEach((rec) => {
    const all = rec.lines.join("\n\n");
    const get = (re) => (all.match(re)?.[1] || "").trim();

    rec.us = get(/Date\/Time\s*[‘'"]?U\/S[’'"]?\s*:\s*([^\n]+)/i);
    rec.defect = get(/\bDefect:\s*([\s\S]*?)(?:\n{1,2}[A-Z][a-z]+:|\n{2,}|$)/i);
    rec.rect = get(/\bRect:\s*([^\n]+)/i);
    rec.etr = get(/\bETR:\s*([^\n]+)/i);

    rec.recovery = /(^|\n)\s*Recovery\s*$/i.test(all) || /post\s*phase\s*rcv/i.test(all);

    rec.gr = [];
    const grMatch = all.match(/G\/?run requirement:\s*([\s\S]*?)(?:\n{2,}|FCF requirement:|Workcenter:|$)/i);
    if (grMatch) {
      rec.gr.push(
        ...grMatch[1].split("\n").map((l) => l.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean)
      );
    }

    rec.fcf = [];
    const fcfMatch = all.match(/FCF requirement:\s*([\s\S]*?)(?:\n{2,}|G\/?run requirement:|Workcenter:|$)/i);
    if (fcfMatch) {
      rec.fcf.push(
        ...fcfMatch[1].split("\n").map((l) => l.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean)
      );
    }

    rec.workcenter = get(/Workcenter:\s*([^\n]+)/i);
    rec.prime = get(/Prime Trade:\s*([^\n]+)/i);
    rec.system = get(/System:\s*([^\n]+)/i);
  });

  return byCode;
}

/* =========================
   HOTO parsing
   ========================= */
function parseHOTO(text) {
  const out = {
    completed: {},
    outstanding: {},
    extra: {
      proj14: [],
      proj28: [],
      proj56: [],
      proj112: [],
      proj112150: [],
      proj180: [],
      mee: [],
      eoss: [],
      bru: [],
      probe: [],
      aom: [],
      lessons: [],
    },
  };

  const lines = (text || "").replace(/\r/g, "").split("\n");
  let section = null;
  let currentCode = null;

  const isMajorHeader = (s) => /^([•■●])\s/.test(s) || /^🟩|^🟥/.test(s);

  const startSection = (line) => {
    if (/🟩\s*Job Completed/i.test(line)) { section = "completed"; currentCode = null; return true; }
    if (/🟥\s*Outstanding/i.test(line)) { section = "outstanding"; currentCode = null; return true; }
    if (/^•\s*14D\s*SERV\s*PROJECTION/i.test(line)) { section = "proj14"; return true; }
    if (/^•\s*28D\s*SERV\s*PROJECTION/i.test(line)) { section = "proj28"; return true; }
    if (/^•\s*56D\s*SERV\s*PROJECTION/i.test(line)) { section = "proj56"; return true; }
    if (/^•\s*112D\/150H?rl?y\s*PROJECTION/i.test(line)) { section = "proj112150"; return true; }
    if (/^•\s*112D\s*SERV\s*PROJECTION/i.test(line)) { section = "proj112"; return true; }
    if (/^•\s*180D\s*SERV\s*PROJECTION/i.test(line)) { section = "proj180"; return true; }
    if (/^■\s*MEE/i.test(line)) { section = "mee"; return true; }
    if (/^■\s*EOSS\s*Status/i.test(line)) { section = "eoss"; return true; }
    if (/^■\s*BRU\s*Status/i.test(line)) { section = "bru"; return true; }
    if (/^■\s*Probe\s*Status/i.test(line)) { section = "probe"; return true; }
    if (/^●\s*AOM/i.test(line)) { section = "aom"; return true; }
    if (/^●\s*Lesson learnt/i.test(line)) { section = "lessons"; return true; }
    return false;
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isMajorHeader(line)) {
      startSection(line);
      continue;
    }

    if (section === "completed" || section === "outstanding") {
      const mCode = line.match(/^([FS]\d)(?:\s*\(([^)]+)\))?.*$/i);
      if (mCode) {
        currentCode = mCode[1].toUpperCase();
        if (section === "completed") {
          if (!out.completed[currentCode]) out.completed[currentCode] = [];
        } else {
          if (!out.outstanding[currentCode]) out.outstanding[currentCode] = { tag: "", items: [] };
          out.outstanding[currentCode].tag = mCode[2]?.trim() || out.outstanding[currentCode].tag || "";
        }
        continue;
      }

      if (/^[-•>]/.test(line) && currentCode) {
        const clean = line.replace(/^[-•]\s*/, "").trim();
        const keep = clean.replace(/^>\s*/, "> ");
        if (section === "completed") out.completed[currentCode].push(keep);
        else out.outstanding[currentCode].items.push(keep);
        continue;
      }

      if (currentCode) {
        if (section === "completed") out.completed[currentCode].push(line);
        else out.outstanding[currentCode].items.push(line);
        continue;
      }
    } else if (section && section in out.extra) {
      const clean = line.replace(/^[-•]\s*/, "").replace(/^>\s*/, "").trim();
      out.extra[section].push(clean);
    }
  }

  return out;
}

/* =========================
   RTS parsing (Daily + Weekly)
   ========================= */

function parseDateHeader(header) {
  const months = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  const line = (header || "").replace(/[^\w\s()/-]/g, "").trim();
  const m = line.match(/^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?/);
  if (!m) {
    return { iso: null, label: header.trim() || "—" };
  }
  const dd = parseInt(m[1], 10);
  const monName = m[2].toLowerCase();
  const mmIndex = months[monName];
  let yyyy;
  if (m[3]) {
    const yr = parseInt(m[3], 10);
    yyyy = yr < 100 ? (2000 + yr) : yr;
  } else {
    yyyy = new Date().getFullYear();
  }
  const iso = (mmIndex != null)
    ? `${yyyy}-${String(mmIndex + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
    : null;

  return { iso, label: line.replace(/\s+\d{4}$/, "").trim() || header.trim() };
}

function splitWeekIntoDays(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const idxs = [];
  const dayRe = /^\s*\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?\s*(?:\([^)]+\))?/;
  for (let i = 0; i < lines.length; i++) {
    if (dayRe.test(lines[i].trim())) idxs.push(i);
  }
  const blocks = [];
  for (let k = 0; k < idxs.length; k++) {
    const start = idxs[k];
    const end = k + 1 < idxs.length ? idxs[k + 1] : lines.length;
    const chunk = lines.slice(start, end).join("\n").trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

function parseSection(lines, startIdx, nextHeaders) {
  const out = [];
  let i = startIdx;
  const guard = new RegExp(`^\\s*(?:${nextHeaders.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  for (; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s) { out.push(""); continue; }
    if (guard.test(s)) break;
    out.push(s);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { items: out, nextIdx: i };
}

function parseMissionLine(ln) {
  const s = (ln || "").trim();
  if (!s || /^nil$/i.test(s)) return null;

  const isSpareText = /\bspare\b(?!\s*window)/i.test(s);
  const mStd = s.match(/^([FS]\d)\s*[:\-]?\s*(\d{3,4}\s*-\s*\d{3,4})?\s*(.*)$/i);
  if (mStd) {
    const code = mStd[1].toUpperCase();
    const time = (mStd[2] || "").replace(/\s+/g, "");
    const rest = (mStd[3] || "").trim();
    if (isSpareText || /^spare\b/i.test(rest)) {
      return { type: "spare", code, label: `${code} Spare${rest.replace(/^spare/i, "") ? " " + rest.replace(/^spare/i, "").trim() : ""}`.trim() };
    }
    const text = [time, rest].filter(Boolean).join(" ");
    return { type: "mission", code, label: text || code };
  }

  const mAsSpare = s.match(/^([FS]\d).*?\bspare\b/i);
  if (mAsSpare && !/\bspare\s*window\b/i.test(s)) {
    const code = mAsSpare[1].toUpperCase();
    return { type: "spare", code, label: s };
  }

  if (/^nil\s*spare/i.test(s)) {
    return { type: "spare", code: null, label: "Nil Spare" };
  }

  if (/^(BMD|RSD)\b/i.test(s)) {
    return { type: "mission", code: null, label: s };
  }

  return null;
}

function parseHealingLine(ln) {
  const s = (ln || "").trim();
  if (!s || /^nil$/i.test(s)) return [];
  const m = s.match(/^([FS]\d)\s*:?\s*(.+)$/i);
  if (!m) return [{ code: null, label: s }];

  const code = m[1].toUpperCase();
  const rhs = m[2].trim();

  const times = [];
  const timeRe = /(\d{3,4}\s*-\s*\d{3,4})/g;
  let lastIndex = 0;
  let match;
  while ((match = timeRe.exec(rhs)) !== null) {
    const chunk = match[1].replace(/\s+/g, "");
    times.push(chunk);
    lastIndex = timeRe.lastIndex;
  }
  if (times.length === 0) {
    return [{ code, label: rhs }];
  }
  const trailing = rhs.slice(lastIndex).trim();
  const items = times.map((t) => ({ code, label: trailing ? `${t} ${trailing}` : t }));
  return items;
}

function parseRTSDaily(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  if (!lines.length) return null;

  const { iso, label } = parseDateHeader(lines[0] || "");

  const H_RTS = /^rts\s*:/i;
  const H_HEAL = /^healing\b/i;
  const H_HOT = /^hot\b/i;
  const H_COLD = /^cold\b/i;
  const H_OPS = /^ops\s*brief\b/i;
  const H_NOTES = /^notes\b/i;

  const isHeader = (s) =>
    H_RTS.test(s) || H_HEAL.test(s) || H_HOT.test(s) || H_COLD.test(s) || H_OPS.test(s) || H_NOTES.test(s);

  let i = 1;
  const missions = [];
  const spares = [];
  const healing = [];
  const hot = [];
  const cold = [];
  const ops = [];
  const notes = [];

  let j = i;
  while (j < lines.length && !isHeader(lines[j].trim())) j++;
  if (j > i) {
    lines.slice(i, j).map((s) => s.trim()).filter(Boolean).forEach((ln) => {
      const m = parseMissionLine(ln);
      if (!m) return;
      if (m.type === "spare") spares.push(m);
      else missions.push(m);
    });
    i = j;
  }

  while (i < lines.length) {
    const s = lines[i].trim();

    if (H_RTS.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, ["Healing", "Hot", "Cold", "Ops Brief", "Notes"]);
      items.forEach((ln) => {
        const m = parseMissionLine(ln);
        if (!m) return;
        if (m.type === "spare") spares.push(m);
        else missions.push(m);
      });
      i = nextIdx;
      continue;
    }

    if (H_HEAL.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, ["Hot", "Cold", "Ops Brief", "Notes"]);
      items.forEach((ln) => healing.push(...parseHealingLine(ln)));
      i = nextIdx;
      continue;
    }

    if (H_HOT.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, ["Cold", "Ops Brief", "Notes"]);
      items.forEach((ln) => { if (/\S/.test(ln) && !/^nil$/i.test(ln)) hot.push(ln); });
      i = nextIdx;
      continue;
    }

    if (H_COLD.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, ["Ops Brief", "Notes"]);
      items.forEach((ln) => { if (/\S/.test(ln) && !/^nil$/i.test(ln)) cold.push(ln); });
      i = nextIdx;
      continue;
    }

    if (H_OPS.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, ["Notes"]);
      items.forEach((ln) => { if (/\S/.test(ln)) ops.push(ln.replace(/[,;]/g, ",").trim()); });
      i = nextIdx;
      continue;
    }

    if (H_NOTES.test(s)) {
      const { items, nextIdx } = parseSection(lines, i + 1, []);
      items.forEach((ln) => { if (/\S/.test(ln)) notes.push(ln); });
      i = nextIdx;
      continue;
    }

    i++;
  }

  return { dateISO: iso, dateLabel: label, missions, spares, healing, hot, cold, ops, notes };
}

function parseRTSWeek(text) {
  const blocks = splitWeekIntoDays(text);
  if (!blocks.length) return [];

  return blocks.map((chunk) => {
    const lines = chunk.split("\n");
    const header = lines[0] || "";
    const { iso, label } = parseDateHeader(header);

    let body = lines.slice(1).join("\n");
    const hasAnyHeader = /(RTS:|Healing|Notes|Hot|Cold|Ops Brief)/i.test(body);
    if (!hasAnyHeader) {
      body = `RTS:\n${body}`;
    }

    const parsed = parseRTSDaily(`${label}\n${body}`);
    return parsed || { dateISO: iso, dateLabel: label, missions: [], spares: [], healing: [], hot: [], cold: [], ops: [], notes: [] };
  });
}

/* =========================
   Servicing helpers
   ========================= */
function parseISO(d) {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return isNaN(dt) ? null : dt;
}
function addDaysISO(dateISO, days) {
  const d = parseISO(dateISO);
  if (!d) return "";
  const nd = new Date(d.getTime() + days * 86400000);
  const yyyy = nd.getFullYear();
  const mm = String(nd.getMonth() + 1).padStart(2, "0");
  const dd = String(nd.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function daysFromToday(dateISO) {
  const d = parseISO(dateISO);
  if (!d) return null;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t0.getTime()) / 86400000);
  return diff; // positive = days remaining; 0 today; negative = overdue days * -1
}
function dueSoonThreshold(type) {
  const meta = SERV_META[type] || {};
  if (meta.windowDays != null) return meta.windowDays;
  if (meta.minor) return 3;
  if (meta.major && meta.freqDays) return Math.max(3, Math.ceil(meta.freqDays * 0.05));
  return 3;
}
function servicingStatus(row) {
  if (row.outputDate) return "completed";
  const d = daysFromToday(row.dueDate);
  if (d == null) return "scheduled";
  if (row.advExtApproved && row.advExtRequired && row.advExtRequired !== "None") return "approved-change";
  if (d < 0) return "overdue";
  if (d <= dueSoonThreshold(row.type)) return "due-soon";
  return "scheduled";
}
function servicingClass(tag) {
  switch (tag) {
    case "completed": return "bg-green-50 border-green-300";
    case "overdue": return "bg-red-50 border-red-300";
    case "due-soon": return "bg-amber-50 border-amber-300";
    case "approved-change": return "bg-blue-50 border-blue-300";
    default: return "bg-gray-50 border-gray-200";
  }
}
function dLabel(dateISO) {
  const d = daysFromToday(dateISO);
  if (d == null) return "—";
  if (d === 0) return "D-0";
  return d > 0 ? `D-${d}` : `D+${Math.abs(d)}`;
}

/* =========================
   App
   ========================= */
export default function App() {
  // ========== Top-level UI state ==========
  const [detail, setDetail] = useState(null); // { id, code, entry } | null

  // Complete redirect-based sign-in (e.g., Safari PWA)
  useEffect(() => {
    completeRedirectSignIn();
  }, []);

  // Firebase Auth state (Google)
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Tabs: 'overview' | 'rts' | 'generator' | 'hoto' | 'servicing' | 'calculator'
  const [tab, setTab] = useState("overview");

  // Date + report editor text
  const [selectedDate, setSelectedDate] = useState(getTodayISO());
  const [reportTitle, setReportTitle] = useState("Night Report");
  const [raw, setRaw] = useState(""); // this drives Overview parsing

  // Auto-jump to newest date in history
  const [followLatest, setFollowLatest] = useState(true);

  // Generator inputs (for composing Night Report)
  const [genSBirds, setGenSBirds] = useState("F2, F3, S2, S3");
  const [genFishing, setGenFishing] = useState("Nil");
  const [genHealing, setGenHealing] = useState("Nil");
  const [tgText, setTgText] = useState("");

  // HOTO checker
  const [hotoRaw, setHotoRaw] = useState("");
  const hoto = useMemo(() => parseHOTO(hotoRaw), [hotoRaw]);
  const [hotoTicks, setHotoTicks] = useState({}); // key `${code}|${text}` -> boolean
  const [hotoDone, setHotoDone] = useState({}); // { code: [itemText, ...] } moved from Outstanding → Completed

  function toggleTick(code, text) {
    const key = `${code}|${text}`;
    setHotoTicks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // RTS inputs/state
  const [rtsDailyRaw, setRtsDailyRaw] = useState("");
  const rtsDaily = useMemo(() => (rtsDailyRaw ? parseRTSDaily(rtsDailyRaw) : null), [rtsDailyRaw]);

  const [rtsWeekRaw, setRtsWeekRaw] = useState("");
  const rtsWeek = useMemo(() => (rtsWeekRaw ? parseRTSWeek(rtsWeekRaw) : []), [rtsWeekRaw]);

  // Servicing rows
  const [servicingRows, setServicingRows] = useState(() => {
    try {
      const raw = localStorage.getItem("servicingRows");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Calculator states
  const [calcBaseDate, setCalcBaseDate] = useState(getTodayISO());
  const calcRows = useMemo(() => {
    if (!calcBaseDate) return [];
    return CALC_INTERVALS.map((d) => {
      const due = addDaysISO(calcBaseDate, d);
      return { days: d, date: due, label: formatDayHeader(due), dLabel: dLabel(due) };
    });
  }, [calcBaseDate]);

  const [engHours, setEngHours] = useState("");
  const [afHours, setAfHours] = useState("");
  const afFromEng = useMemo(() => {
    const v = parseFloat(engHours);
    return Number.isFinite(v) ? (v * ENG_TO_AF).toFixed(1) : "";
  }, [engHours]);
  const engFromAf = useMemo(() => {
    const v = parseFloat(afHours);
    return Number.isFinite(v) ? (v / ENG_TO_AF).toFixed(1) : "";
  }, [afHours]);

  const [currentAF, setCurrentAF] = useState("");
  const [last30AF, setLast30AF] = useState("");
  const [last60AF, setLast60AF] = useState("");

  function nextAtInterval(current, lastDone, interval) {
    const cur = parseFloat(current);
    const last = parseFloat(lastDone);
    const c = Number.isFinite(cur) ? cur : 0;
    if (Number.isFinite(last)) return last + interval;
    // default: next multiple above/equal current
    return Math.ceil(c / interval) * interval;
  }
  const next30 = useMemo(() => nextAtInterval(currentAF, last30AF, 30), [currentAF, last30AF]);
  const next60 = useMemo(() => nextAtInterval(currentAF, last60AF, 60), [currentAF, last60AF]);
  const remAF30 = useMemo(() => {
    const cur = parseFloat(currentAF);
    if (!Number.isFinite(cur)) return null;
    return Math.max(0, next30 - cur);
  }, [currentAF, next30]);
  const remAF60 = useMemo(() => {
    const cur = parseFloat(currentAF);
    if (!Number.isFinite(cur)) return null;
    return Math.max(0, next60 - cur);
  }, [currentAF, next60]);
  const remEng30 = useMemo(() => (remAF30 == null ? null : remAF30 / ENG_TO_AF), [remAF30]);
  const remEng60 = useMemo(() => (remAF60 == null ? null : remAF60 / ENG_TO_AF), [remAF60]);

  // ========== Firestore live data ==========
  const [cloudDates, setCloudDates] = useState([]); // history list
  const docUnsubRef = useRef(null); // per-doc listener cleanup

  // Listen to collection of reports; keep newest first; optionally auto-follow newest
  useEffect(() => {
    const qy = query(collection(db, "reports"), orderBy("__name__"));
    const unsub = onSnapshot(qy, (snap) => {
      const docs = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        docs.push({
          id: d.id,                                   // "YYYY-MM-DD"
          updatedAt: data.updatedAt?.toDate?.() || null,
          savedBy: data.savedBy || null,
          title: data.title || null,
        });
      });

      docs.sort((a, b) => b.id.localeCompare(a.id)); // newest first
      setCloudDates(docs);

      if (docs.length) {
        const newestId = docs[0].id;
        const hasSelected = docs.some((x) => x.id === selectedDate);
        if (followLatest && selectedDate !== newestId) {
          loadCloudDate(newestId);
        } else if (!hasSelected) {
          loadCloudDate(newestId);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followLatest, selectedDate]);

  // Cleanup the per-doc subscription when the component unmounts
  useEffect(() => {
    return () => {
      if (docUnsubRef.current) docUnsubRef.current();
    };
  }, []);

  // Subscribe live to a single day's document
  function loadCloudDate(date) {
    if (!date) return;
    setSelectedDate(date);
    if (docUnsubRef.current) docUnsubRef.current();
    const dref = doc(db, "reports", date);
    docUnsubRef.current = onSnapshot(
      dref,
      (snap) => {
        const data = snap.data();
        if (data) {
          setReportTitle(data.title || "Night Report");
          setRaw(data.raw || "");
          setHotoRaw(data.hotoRaw || "");
          setHotoTicks(data.hotoTicks || {});
          setHotoDone(data.hotoDone || {});
          setRtsDailyRaw(data.rtsDailyRaw || "");
          setRtsWeekRaw(data.rtsWeekRaw || "");
          setServicingRows(data.servicingRows || []);
        } else {
          // New/empty date
          setReportTitle("Night Report");
          setRaw("");
          setHotoRaw("");
          setHotoTicks({});
          setHotoDone({});
          setRtsDailyRaw("");
          setRtsWeekRaw("");
          setServicingRows([]);
        }
      },
      (err) => {
        console.error("Subscribe error:", err);
      }
    );
  }

  // Save the current report (requires whitelisted Google email per your Firestore Rules)
  async function handleSave() {
    if (!user) {
      alert("Please sign in with Google to save.");
      return;
    }
    try {
      await setDoc(doc(db, "reports", selectedDate), {
        title: reportTitle || "Night Report",
        raw,
        // HOTO
        hotoRaw,
        hotoTicks,
        hotoDone, // persist moves
        // RTS
        rtsDailyRaw,
        rtsWeekRaw,
        // Servicing
        servicingRows,
        updatedAt: serverTimestamp(),
        savedBy: user?.email || null,   // who saved
      });
      alert(`Saved cloud report for ${selectedDate}.`);
    } catch (e) {
      console.error(e);
      alert(
        `Save failed. Reason: ${e?.code || "permission-denied"}\n` +
          `Make sure you're signed in with a whitelisted email in Firestore Rules.`
      );
    }
  }

  // Delete an existing date's document
  async function handleDeleteDate(date) {
    if (!user) {
      alert("Please sign in with Google to delete.");
      return;
    }
    if (!date) return;
    if (!confirm(`Delete cloud report for ${date}?`)) return;
    try {
      await deleteDoc(doc(db, "reports", date));
    } catch (e) {
      console.error(e);
      alert("Delete failed (check Firestore rules/whitelist).");
    }
  }

  // Generate Night Report text from HOTO quick inputs + Telegram defects
  function handleGenerate() {
    const defectMap = parseTelegramDefects(tgText || "");

    const sCodes = Array.from(
      new Set(
        (genSBirds || "")
          .split(/[,\s]+/)
          .map((c) => c.trim().toUpperCase())
          .filter((c) => /^[FS]\d$/.test(c))
      )
    );
    const sCount = sCodes.length;

    const lines = [];
    lines.push(`Night Report for ${formatDayHeader(selectedDate)}`);
    lines.push("");
    lines.push(`${sCount} x ‘S’ Bird`);
    lines.push(sCodes.join(", ") || "—");
    lines.push("");
    lines.push("Fishing 🎣");
    lines.push(genFishing || "Nil");
    lines.push("");
    lines.push("Healing ❤️‍🩹");
    lines.push(genHealing || "Nil");
    lines.push("");
    lines.push("Status 🚁");
    lines.push("(* denotes fitted with 'S' EOSS TU)");
    lines.push("(^ denotes fitted with ‘U/S’  EOSS TU)");
    lines.push("");

    const defectCodes = Object.keys(defectMap).sort();
    defectCodes.forEach((code, idx) => {
      const d = defectMap[code];
      lines.push(`*${code} - GR`);
      if (d.us) lines.push(`Input: ${d.us}`);
      if (d.etr) lines.push(`ETR: ${d.etr}`);
      lines.push("");
      if (d.defect) lines.push(`- Defect: ${d.defect}`);
      if (d.rect) lines.push(`> Rect: ${d.rect}`);
      if (d.recovery) { lines.push("> Post phase rcv"); lines.push(""); }
      if (d.gr?.length) {
        lines.push("Requirements"); lines.push("- G/R");
        d.gr.forEach((g) => lines.push(`> ${g}`));
      }
      if (d.fcf?.length) {
        if (!d.gr?.length) lines.push("Requirements");
        lines.push("- FCF");
        d.fcf.forEach((f) => lines.push(`> ${f}`));
      }
      if (idx < defectCodes.length - 1) lines.push("");
    });

    if (defectCodes.length) lines.push("");

    sCodes.filter((c) => !defectMap[c]).forEach((code) => {
      lines.push(`*${code} - S`);
      lines.push("");
    });

    setRaw(lines.join("\n"));
    setTab("overview");
  }

  // Copy Night Report source text to clipboard
  function copyReport() {
    if (!raw) return;
    navigator.clipboard?.writeText(raw).then(
      () => alert("Report copied to clipboard."),
      () => alert("Could not copy (clipboard blocked).")
    );
  }

  // Move ticked Outstanding items → Job Completed (local; persist on Save)
  function moveTickedToCompleted() {
    const updates = {};
    let count = 0;

    Object.keys(hoto.outstanding || {}).forEach((code) => {
      const group = hoto.outstanding[code];
      (group.items || []).forEach((item) => {
        const key = `${code}|${item}`;
        if (hotoTicks[key]) {
          if (!updates[code]) updates[code] = new Set(hotoDone[code] || []);
          if (!updates[code].has(item)) {
            updates[code].add(item);
            count++;
          }
        }
      });
    });

    if (count === 0) {
      alert("No ticked items to move.");
      return;
    }

    if (!confirm(`Move ${count} ticked item(s) to Job Completed?`)) return;

    const nextDone = { ...hotoDone };
    Object.keys(updates).forEach((code) => {
      nextDone[code] = Array.from(updates[code]);
    });
    setHotoDone(nextDone);

    const nextTicks = { ...hotoTicks };
    Object.keys(updates).forEach((code) => {
      updates[code].forEach((item) => {
        const k = `${code}|${item}`;
        delete nextTicks[k];
      });
    });
    setHotoTicks(nextTicks);

    alert("Moved. Click “Save to cloud” to persist.");
  }

  // ========== Derived UI state for Overview ==========
  const parsed = useMemo(() => parseReport(raw), [raw]);

  const cards = useMemo(() => {
    return PLACEHOLDERS.map((id) => {
      const code = idToCode(id);
      const entry = parsed[code];
      return { id, code, entry };
    });
  }, [parsed]);

  const completedMerged = useMemo(() => {
    const merged = {};
    Object.keys(hoto.completed || {}).forEach((code) => {
      merged[code] = [...hoto.completed[code]];
    });
    Object.keys(hotoDone || {}).forEach((code) => {
      if (!merged[code]) merged[code] = [];
      hotoDone[code].forEach((item) => {
        if (!merged[code].includes(item)) merged[code].push(item);
      });
    });
    return merged;
  }, [hoto.completed, hotoDone]);

  function isMoved(code, item) {
    return !!(hotoDone[code]?.includes(item));
  }

  function firstDefectLine(entry) {
    if (!entry) return "";
    const inTitle = (entry.title.match(/defect:\s*(.*)/i) || [])[1];
    if (inTitle) return inTitle.trim();
    const note = entry.notes.find((n) => /^defect:/i.test(n));
    if (note) return note.replace(/^defect:\s*/i, "").trim();
    return entry.title.split(" - ").slice(1).join(" - ");
  }

  // Chip helpers (RTS colors)
  const chipMission = "inline-block text-xs px-2 py-1 rounded border bg-amber-100 border-amber-300 text-amber-900";
  const chipSpare   = "inline-block text-xs px-2 py-1 rounded border bg-gray-100 border-gray-300 text-gray-700";
  const chipHealing = "inline-block text-xs px-2 py-1 rounded border bg-blue-100 border-blue-300 text-blue-900";

  // Local save helpers for tabs
  function saveOverviewLocal() {
    try { localStorage.setItem(`raw_${selectedDate}`, raw || ""); alert("Night Report text saved locally."); }
    catch { alert("Could not save locally."); }
  }
  function saveRTSLocal() {
    try {
      localStorage.setItem(`rtsDaily_${selectedDate}`, rtsDailyRaw || "");
      localStorage.setItem(`rtsWeek_${selectedDate}`, rtsWeekRaw || "");
      alert("RTS text saved locally.");
    } catch { alert("Could not save locally."); }
  }
  function saveHOTOLocal() {
    try {
      localStorage.setItem(`hotoRaw_${selectedDate}`, hotoRaw || "");
      localStorage.setItem(`hotoTicks_${selectedDate}`, JSON.stringify(hotoTicks || {}));
      localStorage.setItem(`hotoDone_${selectedDate}`, JSON.stringify(hotoDone || {}));
      alert("HOTO saved locally.");
    } catch { alert("Could not save locally."); }
  }
  function saveServicingLocal() {
    try {
      localStorage.setItem("servicingRows", JSON.stringify(servicingRows || []));
      alert("Servicing saved locally.");
    } catch { alert("Could not save locally."); }
  }

  // Servicing row helpers
  function addServiceRow() {
    const newRow = {
      id: `srv_${Date.now()}`,
      tail: "",
      type: "56B",
      dueDate: "",
      inputDate: "",
      outputDate: "",
      advExtRequired: "None",       // None | Adv | Ext
      advExtApproved: false,
      remarks: "",
    };
    setServicingRows((prev) => [newRow, ...prev]);
  }
  function updateServiceRow(id, patch) {
    setServicingRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeServiceRow(id) {
    if (!confirm("Remove this servicing row?")) return;
    setServicingRows((prev) => prev.filter((r) => r.id !== id));
  }
  function clearCompletedServices() {
    if (!confirm("Hide all completed rows (rows with Output filled)?")) return;
    setServicingRows((prev) => prev.filter((r) => !r.outputDate));
  }

  // ========== Render ==========
  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      {/* Top bar: title + auth */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Night Report Dashboard</h1>
          <p className="text-sm text-gray-600">
            8 placeholders: 252, 253, 260, 261, 262, 263, 265, 266. Mapping: F → 25x, S → 26x
            (e.g., F2→252, F3→253, S1→261).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="text-sm text-gray-600">Signed in as {user.email}</span>
              <button className="border rounded px-3 py-2 text-sm" onClick={() => signOut(auth)}>
                Sign out
              </button>
            </>
          ) : (
            <button className="border rounded px-3 py-2 text-sm" onClick={signInWithGoogleSmart}>
              Sign in with Google to edit
            </button>
          )}
        </div>
      </div>

      {/* Tabs (Overview / RTS / Generator / HOTO / Servicing / Calculator) */}
      <nav className="mb-6 border-b">
        <ul className="flex gap-2">
          {[
            ["overview", "Overview"],
            ["rts", "RTS"],
            ["generator", "Night report generator"],
            ["hoto", "HOTO checker"],
            ["servicing", "Servicing"],
            ["calculator", "Calculator"],
          ].map(([key, label]) => (
            <li key={key}>
              <button
                className={`px-3 py-2 text-sm border-b-2 ${
                  tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600"
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Global controls (date/title/save) */}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-3">
          {/* Pick a date; picking turns off followLatest so you can browse history */}
          <label className="text-sm">
            <span className="block text-gray-700 mb-1">Report date</span>
            <input
              type="date"
              className="border rounded px-3 py-2 text-sm w-full"
              value={selectedDate}
              onChange={(e) => {
                setFollowLatest(false);
                loadCloudDate(e.target.value);
              }}
            />
          </label>

          {/* Title field */}
          <label className="text-sm md:col-span-2">
            <span className="block text-gray-700 mb-1">Title</span>
            <input
              type="text"
              className="border rounded px-3 py-2 text-sm w-full"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Night Report"
            />
          </label>

          {/* Follow latest toggle */}
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={followLatest}
              onChange={(e) => setFollowLatest(e.target.checked)}
            />
            Follow latest
          </label>

          {/* Save button */}
          <div className="flex flex-wrap gap-2 md:col-span-4">
            <button
              className={`border rounded px-3 py-2 text-sm text-white ${
                user ? "bg-blue-600" : "bg-gray-400 cursor-not-allowed"
              }`}
              onClick={handleSave}
              disabled={!user}
              title="Saves Night Report + HOTO + RTS + Servicing to cloud"
            >
              Save to cloud
            </button>
            <span className="text-xs text-gray-500 self-center">
              {user ? "You can edit & save." : "Sign in to save changes."}
            </span>
          </div>
        </div>
      </header>

      {/* History list of saved reports */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">
          Saved reports (cloud)
          {followLatest && (
            <span className="ml-2 text-xs text-blue-700">(following latest)</span>
          )}
        </h2>

        {cloudDates.length === 0 ? (
          <div className="text-sm text-gray-500">No cloud reports yet.</div>
        ) : (
          <ul className="border rounded divide-y">
            {cloudDates.map((d) => (
              <li
                key={d.id}
                className={`p-2 text-sm ${d.id === selectedDate ? "bg-gray-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="underline text-blue-700 text-left"
                    onClick={() => {
                      setFollowLatest(false);   // pin to this specific date
                      loadCloudDate(d.id);
                    }}
                    title="Load this date"
                  >
                    {d.id}
                  </button>
                  <button
                    className={`${user ? "text-red-700" : "text-gray-400 cursor-not-allowed"}`}
                    onClick={() => handleDeleteDate(d.id)}
                    disabled={!user}
                    title="Delete this date"
                  >
                    Delete
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {d.updatedAt ? d.updatedAt.toLocaleString() : "—"}
                  {d.savedBy ? ` • ${d.savedBy}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tab content */}
      {tab === "overview" && (
        <>
          {/* Cards grid (click a card to open modal with full details) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map(({ id, code, entry }) => {
              const tag = entry?.tag || "none";
              const classes = entry ? statusToClasses(tag) : "bg-gray-50 border-gray-200";

              const short = entry ? firstDefectLine(entry) : "";
              const clickable = !!entry;

              return (
                <div
                  key={id}
                  className={`border rounded-2xl p-4 shadow-sm ${classes} ${
                    clickable ? "cursor-pointer hover:shadow" : "opacity-70"
                  }`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : -1}
                  onClick={() => clickable && setDetail({ id, code, entry })}
                  onKeyDown={(e) => {
                    if (!clickable) return;
                    if (e.key === "Enter" || e.key === " ") setDetail({ id, code, entry });
                  }}
                  title={clickable ? "Click to view full details" : "No data for this tail"}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-lg">{id}</div>
                    <div className="text-xs px-2 py-0.5 rounded bg-white border">{code}</div>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {reportTitle} — {selectedDate}
                  </div>

                  {entry ? (
                    <>
                      <div className="text-sm font-medium mb-1">{entry.title}</div>

                      {/* Status + Input/ETR chips */}
                      <div className="flex flex-wrap gap-2 text-xs mb-2">
                        <span className="px-2 py-0.5 bg-white border rounded">{statusLabel(tag)}</span>
                        {entry.input && (
                          <span className="px-2 py-0.5 bg-white border rounded">Input: {entry.input}</span>
                        )}
                        {entry.etr && (
                          <span className="px-2 py-0.5 bg-white border rounded">ETR: {entry.etr}</span>
                        )}
                      </div>

                      {/* Preview (full details in modal) */}
                      <div className="text-sm">{short}</div>
                    </>
                  ) : (
                    <div className="italic text-sm text-gray-500">No data for {code}.</div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Night Report source editor (you can paste or modify text directly) */}
          <section className="mt-6">
            <h3 className="text-md font-semibold mb-2">Night Report text (source)</h3>
            <textarea
              className="w-full min-h-[240px] border rounded p-3"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Paste or generate your Night Report here…"
            />
            <div className="mt-2 flex gap-2">
              <button className="border rounded px-3 py-2 text-sm" onClick={copyReport} disabled={!raw}>
                Copy Night Report
              </button>
              <button className="border rounded px-3 py-2 text-sm" onClick={saveOverviewLocal}>
                Save locally
              </button>
            </div>
          </section>

          {/* Modal with full details when a card is clicked */}
          {detail && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={() => setDetail(null)}
            >
              <div
                className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="font-semibold">
                    Tail {detail.id} &nbsp; <span className="text-gray-500">({detail.code})</span>
                  </div>
                  <button className="text-sm px-2 py-1 border rounded" onClick={() => setDetail(null)}>
                    Close
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <div className="text-sm text-gray-500">
                    {reportTitle} — {selectedDate}
                  </div>

                  <div className="text-base font-medium">{detail.entry.title}</div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-0.5 bg-gray-50 border rounded">{statusLabel(detail.entry.tag)}</span>
                    {detail.entry.input && (
                      <span className="px-2 py-0.5 bg-gray-50 border rounded">Input: {detail.entry.input}</span>
                    )}
                    {detail.entry.etr && (
                      <span className="px-2 py-0.5 bg-gray-50 border rounded">ETR: {detail.entry.etr}</span>
                    )}
                  </div>

                  {detail.entry.notes?.length ? (
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {detail.entry.notes.map((n, i) => (
                        <li key={i} className="whitespace-pre-wrap">{n}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-gray-500">No additional notes.</div>
                  )}

                  <div className="pt-2">
                    <button
                      className="text-sm px-3 py-2 border rounded"
                      onClick={() => {
                        const e = detail.entry;
                        const lines = [];
                        lines.push(`${e.title}`);
                        if (e.input) lines.push(`Input: ${e.input}`);
                        if (e.etr) lines.push(`ETR: ${e.etr}`);
                        if (e.notes?.length) {
                          lines.push("");
                          e.notes.forEach((ln) => lines.push(ln));
                        }
                        const blob = lines.join("\n");
                        navigator.clipboard?.writeText(blob).then(
                          () => alert("Details copied"),
                          () => alert("Could not copy (clipboard blocked)")
                        );
                      }}
                    >
                      Copy details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "rts" && (
        <>
          {/* RTS: Daily */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold">RTS — Daily</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 text-sm border rounded" onClick={saveRTSLocal}>
                  Save locally
                </button>
                <button
                  className={`px-3 py-2 text-sm text-white ${user ? "bg-blue-600" : "bg-gray-400 cursor-not-allowed"} rounded`}
                  disabled={!user}
                  onClick={handleSave}
                >
                  Save to cloud
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="text-sm block mb-2">
                  <span className="block text-gray-700 mb-1">Paste DAILY RTS</span>
                  <textarea
                    className="w-full min-h-[260px] border rounded p-3"
                    value={rtsDailyRaw}
                    onChange={(e) => setRtsDailyRaw(e.target.value)}
                    placeholder={`13 Aug 25 (Wed) 🚁

F3 1130 - 2200 GH/IF/ASUW/ASW/DIP
S3 Spare

Healing 🏥 
S2 1300 - 1400 FCF

Hot ⛽️ 
F3 1415, 1715, 1845

Cold ⛽️
2230

Ops Brief 🫱🫲:
0900 & 1300

Notes:
S2: Profile A, Profile C, 1/rev, 4/rev
...`}
                  />
                </label>
              </div>
              <div className="border rounded-2xl p-4">
                {rtsDaily ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{rtsDaily.dateLabel}</div>
                      {rtsDaily.dateISO && (
                        <button
                          className="text-xs underline text-blue-700"
                          onClick={() => {
                            setFollowLatest(false);
                            loadCloudDate(rtsDaily.dateISO);
                            setTab("overview");
                          }}
                        >
                          Load this date’s Night Report
                        </button>
                      )}
                    </div>

                    {/* Missions */}
                    {rtsDaily.missions.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Missions</div>
                        <div className="flex flex-wrap gap-2">
                          {rtsDaily.missions.map((m, i) => (
                            <span key={i} className={chipMission}>
                              {m.code ? `${m.code} — ${m.label}` : m.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Spares */}
                    {rtsDaily.spares.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Spare</div>
                        <div className="flex flex-wrap gap-2">
                          {rtsDaily.spares.map((m, i) => (
                            <span key={i} className={chipSpare}>
                              {m.code ? `${m.code} — ${m.label}` : m.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Healing */}
                    {rtsDaily.healing.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Healing</div>
                        <div className="flex flex-wrap gap-2">
                          {rtsDaily.healing.map((h, i) => (
                            <span key={i} className={chipHealing}>
                              {h.code ? `${h.code} — ${h.label}` : h.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Hot/Cold/Ops/Notes */}
                    {rtsDaily.hot.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Hot ⛽️</div>
                        <div className="text-sm whitespace-pre-wrap">{rtsDaily.hot.join("\n")}</div>
                      </div>
                    ) : null}
                    {rtsDaily.cold.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Cold ⛽️</div>
                        <div className="text-sm whitespace-pre-wrap">{rtsDaily.cold.join("\n")}</div>
                      </div>
                    ) : null}
                    {rtsDaily.ops.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Ops Brief</div>
                        <div className="text-sm whitespace-pre-wrap">{rtsDaily.ops.join("\n")}</div>
                      </div>
                    ) : null}
                    {rtsDaily.notes.length ? (
                      <div className="mt-3">
                        <div className="text-sm font-medium mb-1">Notes</div>
                        <ul className="list-disc pl-5 text-sm space-y-1">
                          {rtsDaily.notes.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-gray-500">Paste a DAILY RTS on the left.</div>
                )}
              </div>
            </div>
          </section>

          {/* RTS: Weekly */}
          <section className="mb-6">
            <h2 className="text-xl font-semibold mb-2">RTS — Weekly Plan</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="text-sm block mb-2">
                  <span className="block text-gray-700 mb-1">Paste WEEKLY RTS plan</span>
                  <textarea
                    className="w-full min-h-[320px] border rounded p-3"
                    value={rtsWeekRaw}
                    onChange={(e) => setRtsWeekRaw(e.target.value)}
                    placeholder={`11 Aug - 15 Aug RTS
---------------------------------

11 Aug (Mon)

S3 1100-1830 GH/ASUW/ASW
S6 1230-1830 VIP/ASUW/ASW (ERC)
S5 Spare (ERC)

Healing:
Nil

Notes:
S2 Profile A, Profile C, 1/Rev, 4/Rev
...`}
                  />
                </label>
                <p className="text-xs text-gray-500">
                  Weekly format: missions listed directly under each date, then Healing/Notes etc.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {rtsWeek.length === 0 ? (
                  <div className="text-sm text-gray-500 border rounded p-4">Paste a WEEKLY plan to preview.</div>
                ) : (
                  rtsWeek.map((day, idx) => (
                    <div key={idx} className="border rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{day.dateLabel}</div>
                        {day.dateISO && (
                          <button
                            className="text-xs underline text-blue-700"
                            onClick={() => {
                              setFollowLatest(false);
                              loadCloudDate(day.dateISO);
                              setTab("overview");
                            }}
                          >
                            Load this date’s Night Report
                          </button>
                        )}
                      </div>

                      {/* Missions */}
                      {day.missions.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Missions</div>
                          <div className="flex flex-wrap gap-2">
                            {day.missions.map((m, i) => (
                              <span key={i} className={chipMission}>
                                {m.code ? `${m.code} — ${m.label}` : m.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Spare */}
                      {day.spares.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Spare</div>
                          <div className="flex flex-wrap gap-2">
                            {day.spares.map((m, i) => (
                              <span key={i} className={chipSpare}>
                                {m.code ? `${m.code} — ${m.label}` : m.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Healing */}
                      {day.healing.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Healing</div>
                          <div className="flex flex-wrap gap-2">
                            {day.healing.map((h, i) => (
                              <span key={i} className={chipHealing}>
                                {h.code ? `${h.code} — ${h.label}` : h.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Hot/Cold/Ops/Notes */}
                      {day.hot.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Hot ⛽️</div>
                          <div className="text-sm whitespace-pre-wrap">{day.hot.join("\n")}</div>
                        </div>
                      ) : null}
                      {day.cold.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Cold ⛽️</div>
                          <div className="text-sm whitespace-pre-wrap">{day.cold.join("\n")}</div>
                        </div>
                      ) : null}
                      {day.ops.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Ops Brief</div>
                          <div className="text-sm whitespace-pre-wrap">{day.ops.join("\n")}</div>
                        </div>
                      ) : null}
                      {day.notes.length ? (
                        <div className="mt-3">
                          <div className="text-sm font-medium mb-1">Notes</div>
                          <ul className="list-disc pl-5 text-sm space-y-1">
                            {day.notes.map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {tab === "generator" && (
        <>
          {/* Night Report Generator */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="lg:col-span-1">
              <h2 className="text-lg font-semibold mb-2">HOTO (quick inputs for Report)</h2>

              <label className="text-sm block mb-2">
                <span className="block text-gray-700 mb-1">Serviceable birds (comma-separated)</span>
                <input
                  className="w-full border rounded p-2 text-sm"
                  value={genSBirds}
                  onChange={(e) => setGenSBirds(e.target.value)}
                  placeholder="F2, F3, S2, S3, S5, S6"
                />
              </label>

              <label className="text-sm block mb-2">
                <span className="block text-gray-700 mb-1">Fishing 🎣</span>
                <input
                  className="w-full border rounded p-2 text-sm"
                  value={genFishing}
                  onChange={(e) => setGenFishing(e.target.value)}
                  placeholder="Nil"
                />
              </label>

              <label className="text-sm block">
                <span className="block text-gray-700 mb-1">Healing ❤️‍🩹</span>
                <input
                  className="w-full border rounded p-2 text-sm"
                  value={genHealing}
                  onChange={(e) => setGenHealing(e.target.value)}
                  placeholder="Nil"
                />
              </label>

              <button
                className="mt-3 border rounded px-3 py-2 text-sm bg-emerald-600 text-white"
                onClick={handleGenerate}
              >
                Generate Night Report from HOTO + Telegram
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Generates the Night Report and places it in the source editor.
              </p>
            </div>

            <div className="lg:col-span-2">
              <h2 className="text-lg font-semibold mb-2">Paste Telegram defects</h2>
              <textarea
                className="w-full min-h-[260px] border rounded p-3"
                value={tgText}
                onChange={(e) => setTgText(e.target.value)}
                placeholder="Paste Telegram defect updates here…"
              />
            </div>
          </section>

          <section>
            <h3 className="text-md font-semibold mb-2">Night Report text (source)</h3>
            <textarea
              className="w-full min-h-[280px] border rounded p-3"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Paste or generate your Night Report here…"
            />
            <div className="mt-2 flex gap-2">
              <button className="border rounded px-3 py-2 text-sm" onClick={copyReport} disabled={!raw}>
                Copy Night Report
              </button>
              <button className="border rounded px-3 py-2 text-sm" onClick={saveOverviewLocal}>
                Save locally
              </button>
              <button
                className="border rounded px-3 py-2 text-sm"
                onClick={() => setTab("overview")}
              >
                View in Overview
              </button>
            </div>
          </section>
        </>
      )}

      {tab === "hoto" && (
        <>
          {/* HOTO Checker */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold">HOTO Checker</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 text-sm border rounded" onClick={saveHOTOLocal}>
                  Save locally
                </button>
                <button
                  className={`px-3 py-2 text-sm text-white ${user ? "bg-blue-600" : "bg-gray-400 cursor-not-allowed"} rounded`}
                  disabled={!user}
                  onClick={handleSave}
                >
                  Save to cloud
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1">
                <label className="text-sm block mb-2">
                  <span className="block text-gray-700 mb-1">Paste HOTO text</span>
                  <textarea
                    className="w-full min-h-[280px] border rounded p-3"
                    value={hotoRaw}
                    onChange={(e) => setHotoRaw(e.target.value)}
                    placeholder="Paste HOTO (e.g., 08/08 PM HOTO) here…"
                  />
                </label>
                <p className="text-xs text-gray-500">
                  Tick items under Outstanding, press <b>Done</b> to move them to Job Completed,
                  then click <b>Save to cloud</b> to persist.
                </p>
              </div>

              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-2xl p-4 bg-green-50 border-green-300">
                  <div className="font-semibold mb-2">🟩 Job Completed</div>
                  {Object.keys(completedMerged).length === 0 ? (
                    <div className="text-sm text-gray-500">No completed items.</div>
                  ) : (
                    Object.keys(completedMerged).sort().map((code) => (
                      <div key={code} className="mb-3">
                        <div className="font-medium">{code}</div>
                        <ul className="list-disc pl-5 text-sm space-y-1 mt-1">
                          {completedMerged[code].map((t, i) => (
                            <li key={i}>{t.startsWith("> ") ? <span className="ml-2">{t.slice(2)}</span> : t}</li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>

                <div className="border rounded-2xl p-4 bg-red-50 border-red-300">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">🟥 Outstanding</div>
                    <button
                      className="text-xs border rounded px-2 py-1 bg-blue-600 text-white"
                      onClick={moveTickedToCompleted}
                      title="Move ticked items to Job Completed (saved after you click Save to cloud)"
                    >
                      Done → Move ticked to Completed
                    </button>
                  </div>
                  {Object.keys(hoto.outstanding).length === 0 ? (
                    <div className="text-sm text-gray-500">No outstanding items.</div>
                  ) : (
                    Object.keys(hoto.outstanding).sort().map((code) => {
                      const group = hoto.outstanding[code];
                      return (
                        <div key={code} className="mb-3">
                          <div className="font-medium">
                            {code} {group.tag ? <span className="text-xs text-gray-600">({group.tag})</span> : null}
                          </div>
                          <div className="flex flex-col gap-1 mt-1">
                            {group.items.filter((t) => !isMoved(code, t)).map((t, i) => {
                              const key = `${code}|${t}`;
                              const done = !!hotoTicks[key];
                              return (
                                <label key={i} className="flex items-start gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    checked={done}
                                    onChange={() => toggleTick(code, t)}
                                    title="Mark done (tick is saved with Save button)"
                                  />
                                  <span className={done ? "line-through text-gray-500" : ""}>
                                    {t.startsWith("> ") ? <span className="ml-4">{t.slice(2)}</span> : t}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              {[
                ["proj14", "• 14D SERV PROJECTION"],
                ["proj28", "• 28D SERV PROJECTION"],
                ["proj56", "• 56D SERV PROJECTION"],
                ["proj112", "• 112D SERV PROJECTION"],
                ["proj112150", "• 112D/150Hrly PROJECTION"],
                ["proj180", "• 180D SERV PROJECTION"],
                ["eoss", "■ EOSS Status"],
                ["mee", "■ MEE"],
                ["bru", "■ BRU Status"],
                ["probe", "■ Probe Status"],
                ["aom", "● AOM"],
                ["lessons", "● Lesson learnt"],
              ].map(([key, title]) => (
                <div key={key} className="border rounded-2xl p-4">
                  <div className="font-semibold mb-2">{title}</div>
                  {hoto.extra[key]?.length ? (
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {hoto.extra[key].map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-gray-500">—</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "servicing" && (
        <>
          <section className="mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Servicing</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 text-sm border rounded" onClick={addServiceRow}>
                  + Add row
                </button>
                <button className="px-3 py-2 text-sm border rounded" onClick={clearCompletedServices}>
                  Hide completed
                </button>
                <button className="px-3 py-2 text-sm border rounded" onClick={saveServicingLocal}>
                  Save locally
                </button>
                <button
                  className={`px-3 py-2 text-sm text-white ${user ? "bg-blue-600" : "bg-gray-400 cursor-not-allowed"} rounded`}
                  disabled={!user}
                  onClick={handleSave}
                >
                  Save to cloud
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Color code: <span className="px-1 rounded bg-green-100">Completed</span> /
              <span className="px-1 rounded bg-red-100"> Overdue</span> /
              <span className="px-1 rounded bg-amber-100"> Due soon</span> /
              <span className="px-1 rounded bg-blue-100"> Adv/Ext approved</span> /
              <span className="px-1 rounded bg-gray-100"> Scheduled</span>
            </p>
          </section>

          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm border rounded-2xl overflow-hidden">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-2 py-2 border">Tail</th>
                  <th className="px-2 py-2 border">Type</th>
                  <th className="px-2 py-2 border">Due date</th>
                  <th className="px-2 py-2 border">D-days</th>
                  <th className="px-2 py-2 border">Input</th>
                  <th className="px-2 py-2 border">Output</th>
                  <th className="px-2 py-2 border">Adv/Ext required</th>
                  <th className="px-2 py-2 border">Approved</th>
                  <th className="px-2 py-2 border">Remarks</th>
                  <th className="px-2 py-2 border">Actions</th>
                </tr>
              </thead>
              <tbody>
                {servicingRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center text-gray-500 py-6">
                      No servicing rows. Click <b>+ Add row</b> to begin.
                    </td>
                  </tr>
                ) : (
                  servicingRows.map((r) => {
                    const tag = servicingStatus(r);
                    const classes = servicingClass(tag);
                    return (
                      <tr key={r.id} className={`${classes}`}>
                        <td className="border px-2 py-1">
                          <input
                            className="w-24 border rounded px-2 py-1"
                            value={r.tail || ""}
                            onChange={(e) => updateServiceRow(r.id, { tail: e.target.value })}
                            placeholder="e.g., 253"
                          />
                        </td>
                        <td className="border px-2 py-1">
                          <select
                            className="border rounded px-2 py-1"
                            value={r.type || "56B"}
                            onChange={(e) => updateServiceRow(r.id, { type: e.target.value })}
                          >
                            {SERV_TYPE_OPTIONS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="border px-2 py-1">
                          <input
                            type="date"
                            className="border rounded px-2 py-1"
                            value={r.dueDate || ""}
                            onChange={(e) => updateServiceRow(r.id, { dueDate: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1 text-center">
                          {dLabel(r.dueDate)}
                        </td>
                        <td className="border px-2 py-1">
                          <input
                            type="date"
                            className="border rounded px-2 py-1"
                            value={r.inputDate || ""}
                            onChange={(e) => updateServiceRow(r.id, { inputDate: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1">
                          <input
                            type="date"
                            className="border rounded px-2 py-1"
                            value={r.outputDate || ""}
                            onChange={(e) => updateServiceRow(r.id, { outputDate: e.target.value })}
                          />
                        </td>
                        <td className="border px-2 py-1">
                          <select
                            className="border rounded px-2 py-1"
                            value={r.advExtRequired || "None"}
                            onChange={(e) => updateServiceRow(r.id, { advExtRequired: e.target.value })}
                          >
                            <option value="None">None</option>
                            <option value="Adv">Adv</option>
                            <option value="Ext">Ext</option>
                          </select>
                        </td>
                        <td className="border px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={!!r.advExtApproved}
                            onChange={(e) => updateServiceRow(r.id, { advExtApproved: e.target.checked })}
                          />
                        </td>
                        <td className="border px-2 py-1">
                          <input
                            className="w-full border rounded px-2 py-1"
                            value={r.remarks || ""}
                            onChange={(e) => updateServiceRow(r.id, { remarks: e.target.value })}
                            placeholder="Notes..."
                          />
                        </td>
                        <td className="border px-2 py-1 text-center">
                          <button className="text-red-700 underline" onClick={() => removeServiceRow(r.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Legend / Helper */}
          <div className="text-xs text-gray-600 mt-3">
            <div>• Minor (7/14/28/56A/B): due-soon threshold = 3 days.</div>
            <div>• Major (112/365/730/1430): due-soon threshold = 5% of interval (rounded), unless a window is specified above (e.g., 365D = 30 days).</div>
            <div>• “Adv/Ext approved” shows as blue even if not yet within window.</div>
          </div>
        </>
      )}

      {tab === "calculator" && (
        <>
          <section className="mb-6">
            <h2 className="text-xl font-semibold mb-2">Calculator</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Date-based projection */}
              <div className="border rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Date projection (14 → 365 days)</div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs border rounded px-2 py-1"
                      onClick={() => setCalcBaseDate(getTodayISO())}
                    >
                      Today
                    </button>
                    <button
                      className="text-xs border rounded px-2 py-1"
                      onClick={() => setCalcBaseDate(selectedDate)}
                      title="Use the Night Report date"
                    >
                      Use report date
                    </button>
                  </div>
                </div>

                <label className="block text-sm mt-3">
                  <span className="block text-gray-700 mb-1">Base date</span>
                  <input
                    type="date"
                    className="border rounded px-3 py-2 text-sm"
                    value={calcBaseDate}
                    onChange={(e) => setCalcBaseDate(e.target.value)}
                  />
                </label>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm border rounded">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border px-2 py-1 text-left">Interval</th>
                        <th className="border px-2 py-1 text-left">Due date</th>
                        <th className="border px-2 py-1 text-left">Day</th>
                        <th className="border px-2 py-1 text-left">D-days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calcRows.map((r) => (
                        <tr key={r.days}>
                          <td className="border px-2 py-1">{r.days}D</td>
                          <td className="border px-2 py-1">{r.date}</td>
                          <td className="border px-2 py-1">{r.label}</td>
                          <td className="border px-2 py-1">{r.dLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2">
                  <button
                    className="text-sm border rounded px-3 py-2"
                    onClick={() => {
                      const lines = calcRows.map(r => `${r.days}D — ${r.date} (${r.label}) ${r.dLabel}`);
                      const text = `Base: ${calcBaseDate}\n` + lines.join("\n");
                      navigator.clipboard?.writeText(text).then(
                        () => alert("Projection copied"),
                        () => alert("Could not copy (clipboard blocked)")
                      );
                    }}
                  >
                    Copy projection
                  </button>
                </div>
              </div>

              {/* Hours converter & triggers */}
              <div className="border rounded-2xl p-4">
                <div className="font-medium">Hours converter (Eng ↔ AF) & next 30H/60H</div>

                {/* Converter */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">Engine hours → AF (×0.85)</span>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={engHours}
                      onChange={(e) => setEngHours(e.target.value)}
                      placeholder="e.g., 10"
                      inputMode="decimal"
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      AF hours: <b>{afFromEng || "—"}</b>
                    </div>
                  </label>

                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">AF hours → Eng (÷0.85)</span>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={afHours}
                      onChange={(e) => setAfHours(e.target.value)}
                      placeholder="e.g., 8"
                      inputMode="decimal"
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      Eng hours: <b>{engFromAf || "—"}</b>
                    </div>
                  </label>
                </div>

                {/* Next 30/60 triggers */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">Current AF hours</span>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={currentAF}
                      onChange={(e) => setCurrentAF(e.target.value)}
                      placeholder="e.g., 152.3"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">Last 30H done @ AF (optional)</span>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={last30AF}
                      onChange={(e) => setLast30AF(e.target.value)}
                      placeholder="e.g., 120.0"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">Last 60H done @ AF (optional)</span>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={last60AF}
                      onChange={(e) => setLast60AF(e.target.value)}
                      placeholder="e.g., 120.0"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <div className="mt-3 text-sm border rounded p-3 bg-gray-50">
                  <div className="font-medium mb-1">Next triggers</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="border rounded p-2 bg-white">
                      <div className="text-xs text-gray-500">30H</div>
                      <div>Next @ AF: <b>{Number.isFinite(next30) ? next30.toFixed(1) : "—"}</b></div>
                      <div>
                        Remaining:{" "}
                        <b>
                          {remAF30 == null ? "—" : `${remAF30.toFixed(1)} AF (~${(remEng30 ?? 0).toFixed(1)} Eng)`}
                        </b>
                      </div>
                    </div>
                    <div className="border rounded p-2 bg-white">
                      <div className="text-xs text-gray-500">60H</div>
                      <div>Next @ AF: <b>{Number.isFinite(next60) ? next60.toFixed(1) : "—"}</b></div>
                      <div>
                        Remaining:{" "}
                        <b>
                          {remAF60 == null ? "—" : `${remAF60.toFixed(1)} AF (~${(remEng60 ?? 0).toFixed(1)} Eng)`}
                        </b>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    If “Last … done” is blank, next trigger is rounded up to the nearest multiple above current AF.
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-gray-500 whitespace-pre-line">
        Version {APP_VERSION}
      </footer>
    </div>
  );
}
