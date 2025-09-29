import React, { useMemo } from "react";
import { parseHOTO } from "../utils/parsers/hoto";

export default function HOTO({
  hotoRaw, setHotoRaw,
  hotoTicks, setHotoTicks,
  hotoDone, setHotoDone,
}) {
  const hoto = useMemo(() => parseHOTO(hotoRaw), [hotoRaw]);

  const completedMerged = useMemo(() => {
    const merged = {};
    Object.keys(hoto.completed || {}).forEach((code) => (merged[code] = [...hoto.completed[code]]));
    Object.keys(hotoDone || {}).forEach((code) => {
      if (!merged[code]) merged[code] = [];
      (hotoDone[code] || []).forEach((item) => { if (!merged[code].includes(item)) merged[code].push(item); });
    });
    return merged;
  }, [hoto.completed, hotoDone]);

  function isMoved(code, item) { return !!(hotoDone[code]?.includes(item)); }
  function toggleTick(code, text) {
    const key = `${code}|${text}`;
    setHotoTicks((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function moveTickedToCompleted() {
    const updates = {}; let count = 0;
    Object.keys(hoto.outstanding || {}).forEach((code) => {
      const group = hoto.outstanding[code];
      (group.items || []).forEach((item) => {
        const key = `${code}|${item}`;
        if (hotoTicks[key]) {
          if (!updates[code]) updates[code] = new Set(hotoDone[code] || []);
          if (!updates[code].has(item)) { updates[code].add(item); count++; }
        }
      });
    });
    if (count === 0) { alert("No ticked items to move."); return; }
    if (!confirm(`Move ${count} ticked item(s) to Job Completed?`)) return;

    const nextDone = { ...hotoDone };
    Object.keys(updates).forEach((code) => (nextDone[code] = Array.from(updates[code])));
    setHotoDone(nextDone);

    const nextTicks = { ...hotoTicks };
    Object.keys(updates).forEach((code) => { updates[code].forEach((item) => { delete nextTicks[`${code}|${item}`]; }); });
    setHotoTicks(nextTicks);

    alert("Moved. Click “Save to cloud” to persist.");
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">HOTO Checker</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <label className="text-sm block mb-2">
              <span className="block text-gray-700 mb-1">Paste HOTO text</span>
              <textarea
                className="w-full min-h-[280px] border rounded-md p-3"
                value={hotoRaw}
                onChange={(e) => setHotoRaw(e.target.value)}
                placeholder="Paste HOTO (e.g., 08/08 PM HOTO) here…"
              />
            </label>
            <p className="text-xs text-gray-500">
              Tick items under Outstanding → press <b>Done</b> → <b>Save to cloud</b>.
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
                <button className="text-xs border rounded-md px-2 py-1 bg-blue-600 text-white" onClick={moveTickedToCompleted}>
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
                              <input type="checkbox" className="mt-0.5" checked={done} onChange={() => toggleTick(code, t)} />
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

        {/* Extras */}
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
                  {hoto.extra[key].map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">—</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
