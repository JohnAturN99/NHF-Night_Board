import React, { useMemo, useState } from "react";
import { PLACEHOLDERS, idToCode } from "../utils/mapping";
import { parseNightReport, firstDefectLine } from "../utils/parsers/nightReport";

function statusToClasses(tag) {
  switch (tag) {
    case "serviceable":   return "bg-green-50 border-green-300";
    case "rectification": return "bg-red-50 border-red-300";
    case "in-phase":      return "bg-orange-50 border-orange-300";
    case "recovery":      return "bg-blue-50 border-blue-300";
    default:              return "bg-gray-50 border-gray-200";
  }
}

export default function Overview({ selectedDate, reportTitle, nightRaw, setNightRaw }) {
  const [detail, setDetail] = useState(null);
  const parsed = useMemo(() => parseNightReport(nightRaw), [nightRaw]);

  const cards = useMemo(
    () => PLACEHOLDERS.map((id) => ({ id, code: idToCode(id), entry: parsed[idToCode(id)] })),
    [parsed]
  );

  function copyNightReport() {
    if (!nightRaw) return;
    navigator.clipboard.writeText(nightRaw).then(() => alert("Night Report copied."));
  }

  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ id, code, entry }) => {
          const tag = entry?.tag || "none";
          const classes = entry ? statusToClasses(tag) : "bg-gray-50 border-gray-200";
          const short = entry ? firstDefectLine(entry) : "";
          const clickable = !!entry;

          return (
            <div
              key={id}
              className={`border rounded-2xl p-4 shadow-sm ${classes} ${clickable ? "cursor-pointer hover:shadow" : "opacity-70"}`}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : -1}
              onClick={() => clickable && setDetail({ id, code, entry })}
              onKeyDown={(e) => (clickable && (e.key === "Enter" || e.key === " ")) ? setDetail({ id, code, entry }) : null}
              title={clickable ? "Click to view full details" : "No data for this tail"}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-lg">{id}</div>
                <div className="text-xs px-2 py-0.5 rounded-md bg-white border">{code}</div>
              </div>
              <div className="text-xs text-gray-500 mb-2">
                {reportTitle} — {selectedDate}
              </div>
              {entry ? (
                <>
                  <div className="text-sm font-medium mb-1">{entry.title}</div>
                  <div className="flex flex-wrap gap-2 text-xs mb-2">
                    {entry.input && <span className="px-2 py-0.5 bg-white border rounded-md">Input: {entry.input}</span>}
                    {entry.etr &&   <span className="px-2 py-0.5 bg-white border rounded-md">ETR: {entry.etr}</span>}
                    <span className="px-2 py-0.5 bg-white border rounded-md">
                      {tag === "serviceable" && "Serviceable"}
                      {tag === "rectification" && "Rectification"}
                      {tag === "in-phase" && "In Phase"}
                      {tag === "recovery" && "Recovery"}
                      {tag === "none" && "No status"}
                    </span>
                  </div>
                  <div className="text-sm">{short}</div>
                </>
              ) : (
                <div className="italic text-sm text-gray-500">No data for {code}.</div>
              )}
            </div>
          );
        })}
      </section>

      <section className="mt-6">
        <h3 className="text-md font-semibold mb-2">Night Report text (source)</h3>
        <textarea
          className="w-full min-h-[240px] border rounded-md p-3"
          value={nightRaw}
          onChange={(e) => setNightRaw(e.target.value)}
          placeholder="Paste or generate your Night Report here…"
        />
        <div className="mt-2 flex gap-2">
          <button className="border rounded-md px-3 py-2 text-sm" onClick={copyNightReport} disabled={!nightRaw}>
            Copy Night Report
          </button>
        </div>
      </section>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-semibold">
                Tail {detail.id} &nbsp; <span className="text-gray-500">({detail.code})</span>
              </div>
              <button className="text-sm px-2 py-1 border rounded-md" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-sm text-gray-500">{reportTitle} — {selectedDate}</div>
              <div className="text-base font-medium">{detail.entry.title}</div>

              <div className="flex flex-wrap gap-2 text-xs">
                {detail.entry.input && <span className="px-2 py-0.5 bg-gray-50 border rounded-md">Input: {detail.entry.input}</span>}
                {detail.entry.etr &&   <span className="px-2 py-0.5 bg-gray-50 border rounded-md">ETR: {detail.entry.etr}</span>}
              </div>

              {detail.entry.notes?.length ? (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {detail.entry.notes.map((n, i) => <li key={i} className="whitespace-pre-wrap">{n}</li>)}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No additional notes.</div>
              )}

              <div className="pt-2">
                <button
                  className="text-sm px-3 py-2 border rounded-md"
                  onClick={() => {
                    const e = detail.entry;
                    const lines = [];
                    lines.push(e.title);
                    if (e.input) lines.push(`Input: ${e.input}`);
                    if (e.etr)   lines.push(`ETR: ${e.etr}`);
                    if (e.notes?.length) { lines.push(""); e.notes.forEach((ln) => lines.push(ln)); }
                    navigator.clipboard.writeText(lines.join("\n")).then(
                      () => alert("Details copied"),
                      () => alert("Clipboard blocked")
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
  );
}
