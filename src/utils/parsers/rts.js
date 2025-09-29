export function parseDateHeader(header) {
  const months = {
    jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,
    jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11
  };
  const line = (header || "").replace(/[^\w\s()/-]/g, "").trim();
  const m = line.match(/^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?/);
  if (!m) return { iso: null, label: header.trim() || "—" };
  const dd = parseInt(m[1], 10);
  const mm = months[m[2].toLowerCase()];
  let yyyy;
  if (m[3]) {
    const yr = parseInt(m[3], 10);
    yyyy = yr < 100 ? 2000 + yr : yr;
  } else {
    yyyy = new Date().getFullYear();
  }
  const iso = mm != null ? `${yyyy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null;
  return { iso, label: line.replace(/\s+\d{4}$/, "").trim() || header.trim() };
}

function parseMissionLine(ln) {
  const s = (ln || "").trim();
  if (!s || /^nil$/i.test(s)) return null;
  const isSpare = /\bspare\b(?!\s*window)/i.test(s);

  const mStd = s.match(/^([FS]\d)\s*[:\-]?\s*(\d{3,4}\s*-\s*\d{3,4})?\s*(.*)$/i);
  if (mStd) {
    const code = mStd[1].toUpperCase();
    const time = (mStd[2] || "").replace(/\s+/g, "");
    const rest = (mStd[3] || "").trim();
    if (isSpare || /^spare\b/i.test(rest)) {
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

  if (/^nil\s*spare/i.test(s)) return { type: "spare", code: null, label: "Nil Spare" };
  if (/^(BMD|RSD)\b/i.test(s)) return { type: "mission", code: null, label: s };
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
  const re = /(\d{3,4}\s*-\s*\d{3,4})/g;
  let lastIndex = 0, t;
  while ((t = re.exec(rhs)) !== null) {
    times.push(t[1].replace(/\s+/g, ""));
    lastIndex = re.lastIndex;
  }
  if (!times.length) return [{ code, label: rhs }];
  const trailing = rhs.slice(lastIndex).trim();
  return times.map((tt) => ({ code, label: trailing ? `${tt} ${trailing}` : tt }));
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

export function parseDailyRTS(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  if (!lines.length) return null;
  const { iso, label } = parseDateHeader(lines[0] || "");

  const H_RTS=/^rts\s*:/i, H_HEAL=/^healing\b/i, H_HOT=/^hot\b/i, H_COLD=/^cold\b/i, H_OPS=/^ops\s*brief\b/i, H_NOTES=/^notes\b/i;
  const isHeader = (s) => H_RTS.test(s) || H_HEAL.test(s) || H_HOT.test(s) || H_COLD.test(s) || H_OPS.test(s) || H_NOTES.test(s);

  let i = 1;
  const missions=[], spares=[], healing=[], hot=[], cold=[], ops=[], notes=[];

  let j=i; while(j<lines.length && !isHeader(lines[j].trim())) j++;
  if (j>i) {
    lines.slice(i,j).map(s=>s.trim()).filter(Boolean).forEach(ln=>{
      const m = parseMissionLine(ln);
      if (!m) return;
      if (m.type==="spare") spares.push(m); else missions.push(m);
    });
    i=j;
  }

  while (i<lines.length) {
    const s = lines[i].trim();

    if (H_RTS.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, ["Healing","Hot","Cold","Ops Brief","Notes"]);
      items.forEach(ln=>{ const m=parseMissionLine(ln); if(!m) return; if(m.type==="spare") spares.push(m); else missions.push(m); });
      i=nextIdx; continue;
    }
    if (H_HEAL.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, ["Hot","Cold","Ops Brief","Notes"]);
      items.forEach(ln=>healing.push(...parseHealingLine(ln)));
      i=nextIdx; continue;
    }
    if (H_HOT.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, ["Cold","Ops Brief","Notes"]);
      items.forEach(ln=>{ if(/\S/.test(ln) && !/^nil$/i.test(ln)) hot.push(ln); });
      i=nextIdx; continue;
    }
    if (H_COLD.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, ["Ops Brief","Notes"]);
      items.forEach(ln=>{ if(/\S/.test(ln) && !/^nil$/i.test(ln)) cold.push(ln); });
      i=nextIdx; continue;
    }
    if (H_OPS.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, ["Notes"]);
      items.forEach(ln=>{ if(/\S/.test(ln)) ops.push(ln.replace(/[,;]/g, ",").trim()); });
      i=nextIdx; continue;
    }
    if (H_NOTES.test(s)) {
      const {items,nextIdx} = parseSection(lines, i+1, []);
      items.forEach(ln=>{ if(/\S/.test(ln)) notes.push(ln); });
      i=nextIdx; continue;
    }

    i++;
  }

  return { dateISO: iso, dateLabel: label, missions, spares, healing, hot, cold, ops, notes };
}

export function splitWeekIntoDays(text) {
  const lines=(text||"").replace(/\r/g,"").split("\n");
  const idxs=[], dayRe=/^\s*\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?\s*(?:\([^)]+\))?/;
  for (let i=0;i<lines.length;i++){ if (dayRe.test(lines[i].trim())) idxs.push(i); }
  const blocks=[];
  for (let k=0;k<idxs.length;k++){
    const start=idxs[k], end=(k+1<idxs.length?idxs[k+1]:lines.length);
    const chunk = lines.slice(start,end).join("\n").trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

export function parseWeeklyRTS(text) {
  const blocks = splitWeekIntoDays(text);
  if (!blocks.length) return [];
  return blocks.map((chunk)=>{
    const lines=chunk.split("\n");
    const header=lines[0]||"";
    const {iso,label}=parseDateHeader(header);
    let body=lines.slice(1).join("\n");
    const hasHeader=/(RTS:|Healing|Notes|Hot|Cold|Ops Brief)/i.test(body);
    if(!hasHeader) body = `RTS:\n${body}`;
    const parsed = parseDailyRTS(`${label}\n${body}`);
    return parsed || { dateISO: iso, dateLabel: label, missions:[], spares:[], healing:[], hot:[], cold:[], ops:[], notes:[] };
  });
}
