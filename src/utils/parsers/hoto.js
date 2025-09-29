export function parseHOTO(text) {
  const out = {
    completed: {},
    outstanding: {},
    extra: {
      proj14: [], proj28: [], proj56: [], proj112: [], proj112150: [], proj180: [],
      mee: [], eoss: [], bru: [], probe: [], aom: [], lessons: [],
    },
  };

  const lines = (text || "").replace(/\r/g, "").split("\n");
  let section = null, currentCode = null;

  const isMajorHeader = (s) => /^([•■●])\s/.test(s) || /^🟩|^🟥/.test(s);

  const startSection = (line) => {
    if (/🟩\s*Job Completed/i.test(line)) { section = "completed"; currentCode = null; return true; }
    if (/🟥\s*Outstanding/i.test(line)) { section = "outstanding"; currentCode = null; return true; }
    if (/^•\s*14D/i.test(line)) { section = "proj14"; return true; }
    if (/^•\s*28D/i.test(line)) { section = "proj28"; return true; }
    if (/^•\s*56D/i.test(line)) { section = "proj56"; return true; }
    if (/^•\s*112D\/150/i.test(line)) { section = "proj112150"; return true; }
    if (/^•\s*112D(?!\/)/i.test(line)) { section = "proj112"; return true; }
    if (/^•\s*180D/i.test(line)) { section = "proj180"; return true; }
    if (/^■\s*MEE/i.test(line)) { section = "mee"; return true; }
    if (/^■\s*EOSS/i.test(line)) { section = "eoss"; return true; }
    if (/^■\s*BRU/i.test(line)) { section = "bru"; return true; }
    if (/^■\s*Probe/i.test(line)) { section = "probe"; return true; }
    if (/^●\s*AOM/i.test(line)) { section = "aom"; return true; }
    if (/^●\s*Lesson/i.test(line)) { section = "lessons"; return true; }
    return false;
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isMajorHeader(line)) { startSection(line); continue; }

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
        const keep  = clean.replace(/^>\s*/, "> ");
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
