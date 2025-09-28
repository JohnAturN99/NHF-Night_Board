function deriveStatusTag(entry) {
  const title = entry.title.toLowerCase();
  const notes = (entry.notes || []).join(" ").toLowerCase();

  const hasDefect =
    /\bdefect:/.test(title) ||
    /\bdefect:/.test(notes) ||
    /\brect:/.test(title) ||
    /\brect:/.test(notes) ||
    /\bgr\b/.test(title) ||
    /\bgr\b/.test(notes);

  const inPhase = /(major serv|phase\b)/.test(title);
  const recovery =
    /(post phase rcv|recovery)/.test(title) ||
    /(post phase rcv|recovery)/.test(notes);

  if (hasDefect) return "rectification";
  if (inPhase) return "in-phase";
  if (recovery) return "recovery";
  if (/\s-\s*s(\b|$)/i.test(entry.title)) return "serviceable";
  return "serviceable";
}

export function parseNightReport(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const entries = {};
  let current = null;

  const header = /^[>*\s-]*\*?\s*([SF]\d)\s*-\s*(.+)$/i;

  for (const line of lines) {
    if (!line) continue;

    const h = header.exec(line);
    if (h) {
      const code = h[1].toUpperCase();
      const tail = h[2].trim();
      entries[code] = { code, title: `${code} - ${tail}`, input: "", etr: "", notes: [] };
      current = code;
      continue;
    }
    if (!current) continue;

    const mInput = /^Input:\s*(.+)$/i.exec(line);
    if (mInput) { entries[current].input = mInput[1].trim(); continue; }

    const mEtr = /^ETR:\s*(.+)$/i.exec(line);
    if (mEtr) { entries[current].etr = mEtr[1].trim(); continue; }

    if (/^>/.test(line))  { entries[current].notes.push(line.replace(/^>\s*/, "")); continue; }
    if (/^-/.test(line))  { entries[current].notes.push(line.replace(/^-+\s*/, "")); continue; }
    if (/^Requirements$/i.test(line)) { entries[current].notes.push("Requirements:"); continue; }
  }

  Object.keys(entries).forEach((k) => (entries[k].tag = deriveStatusTag(entries[k])));
  return entries;
}

export function firstDefectLine(entry) {
  if (!entry) return "";
  const inTitle = (entry.title.match(/defect:\s*(.*)/i) || [])[1];
  if (inTitle) return inTitle.trim();
  const note = entry.notes?.find((n) => /^defect:/i.test(n));
  if (note) return note.replace(/^defect:\s*/i, "").trim();
  return entry.title.split(" - ").slice(1).join(" - ");
}
