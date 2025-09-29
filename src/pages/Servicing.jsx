// src/pages/Servicing.jsx
import React, { useEffect, useMemo, useState } from "react";

/** ====== Constants ====== */
const PLACEHOLDERS = [252, 253, 260, 261, 262, 263, 265, 266];
function idToCode(id) {
  if (id >= 251 && id <= 259) return `F${id - 250}`;
  if (id >= 260 && id <= 269) return `S${id - 260}`;
  return String(id);
}
const TAILS = PLACEHOLDERS.map((id) => ({ id, code: idToCode(id) }));

// Service library (from your “Data Validation”)
// duration = planned working days, recovery = typical extra recovery days (planning buffer)
const SERVICE_DEFS = {
  // Minor
  "14D": { kind: "minor", duration: 2, recovery: 0 },
  "28D": { kind: "minor", duration: 2, recovery: 0 },
  "56D (A)": { kind: "minor", duration: 2, recovery: 0 },
  "56D (B)": { kind: "minor", duration: 4, recovery: 0 },
  "30 Hrly": { kind: "minor", duration: 1, recovery: 0 },
  "60 Hrly": { kind: "minor", duration: 1, recovery: 0 },

  // Major
  "112D": { kind: "major", duration: 5, recovery: 0 }, // optional baseline
  "365D": { kind: "major", duration: 30, recovery: 5 },
  "365D + A": { kind: "major", duration: 50, recovery: 10 },
  "365D + B": { kind: "major", duration: 60, recovery: 10 },
  "Phase A": { kind: "major", duration: 40, recovery: 5 },
  "Phase B": { kind: "major", duration: 50, recovery: 5 },
  "Whidbey": { kind: "major", duration: 20, recovery: 10 },
};

const MINOR_TYPES = Object.keys(SERVICE_DEFS).filter((k) => SERVICE_DEFS[k].kind === "minor");
const MAJOR_TYPES = Object.keys(SERVICE_DEFS).filter((k) => SERVICE_DEFS[k].kind === "major");

// 56D cycle helper: after 56D (B) → plan 56D (A); after A → next B
function nextMinorCycle(type) {
  if (type === "56D (B)") return "56D (A)";
  if (type === "56D (A)") return "56D (B)";
  return type;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(aISO, bISO) {
  if (!aISO || !bISO) return null;
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/** ====== Small badge ====== */
function StatusBadge({ state }) {
  const map = {
    completed: "bg-green-100 text-green-800 border-green-300",
    overdue: "bg-red-100 text-red-800 border-red-300",
    dueSoon: "bg-amber-100 text-amber-900 border-amber-300",
    planned: "bg-gray-100 text-gray-700 border-gray-300",
  };
  const label =
    state === "completed" ? "Completed" : state === "overdue" ? "Overdue" : state === "dueSoon" ? "Due soon" : "Planned";
  return <span className={`inline-block text-xs px-2 py-0.5 rounded border ${map[state]}`}>{label}</span>;
}

/** ====== Row shape ======
 * {
 *   id, tail, type, due, input, output,
 *   advReq, advApproved, extReq, extApproved,
 *   remarks, completed, completedOn
 * }
 */
const EMPTY_ROW = {
  id: "",
  tail: "F2",
  type: "56D (B)",
  due: "",
  input: "",
  output: "",
  advReq: false,
  advApproved: false,
  extReq: false,
  extApproved: false,
  remarks: "",
  completed: false,
  completedOn: "",
};

export default function Servicing({ rows, setRows, onSaveLocal }) {
  const [draft, setDraft] = useState(EMPTY_ROW);

  // Load any local cache (optional one-click “Save locally”)
  useEffect(() => {
    // no-op here; parent can pass rows already
  }, []);

  // Derived statuses
  const withStatus = useMemo(() => {
    const tISO = todayISO();
    return (rows || []).map((r) => {
      let state = "planned";
      if (r.completed) state = "completed";
      else if (r.due) {
        const delta = daysBetween(tISO, r.due);
        if (delta != null) {
          if (delta < 0) state = "overdue";
          else {
            const def = SERVICE_DEFS[r.type] || { kind: "minor" };
            // “due soon” = within 3 days for minor, within 5% of nominal for major (min 5 days)
            const soonThreshold = def.kind === "major"
              ? Math.max(5, Math.ceil((def.duration || 30) * 0.05))
              : 3;
            if (delta <= soonThreshold) state = "dueSoon";
          }
        }
      }
      return { ...r, _state: state };
    });
  }, [rows]);

  const minorRows = useMemo(() => withStatus.filter((r) => (SERVICE_DEFS[r.type]?.kind || "minor") === "minor"), [withStatus]);
  const majorRows = useMemo(() => withStatus.filter((r) => SERVICE_DEFS[r.type]?.kind === "major"), [withStatus]);

  function addRow() {
    if (!draft.tail || !draft.type) return alert("Select tail and service type.");
    const id = `${draft.tail}-${draft.type}-${Date.now()}`;
    setRows([...(rows || []), { ...draft, id }]);
    // Smart suggestion: for 56D cycle switch A/B next time
    setDraft((d) => ({ ...EMPTY_ROW, tail: d.tail, type: nextMinorCycle(d.type) }));
  }

  function updateRow(id, patch) {
    setRows((prev) => (prev || []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id) {
    if (!confirm("Delete this servicing row?")) return;
    setRows((prev) => (prev || []).filter((r) => r.id !== id));
  }

  function copyCSV() {
    const header = [
      "Tail",
      "Type",
      "Due",
      "Input",
      "Output",
      "Adv Req",
      "Adv Approved",
      "Ext Req",
      "Ext Approved",
      "Completed",
      "Completed On",
      "Remarks",
    ];
    const data = (rows || []).map((r) =>
      [
        r.tail,
        r.type,
        r.due || "",
        r.input || "",
        r.output || "",
        r.advReq ? "Y" : "N",
        r.advApproved ? "Y" : "N",
        r.extReq ? "Y" : "N",
        r.extApproved ? "Y" : "N",
        r.completed ? "Y" : "N",
        r.completedOn || "",
        (r.remarks || "").replace(/\n/g, " "),
      ].join(",")
    );
    const blob = [header.join(","), ...data].join("\n");
    navigator.clipboard?.writeText(blob).then(
      () => alert("Copied CSV to clipboard."),
      () => alert("Could not copy (clipboard blocked).")
    );
  }

  return (
    <div className="space-y-8">
      {/* Quick add */}
      <section className="border rounded-2xl p-4">
        <div className="font-semibold mb-3">Add servicing</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <label className="text-sm">
            <div className="mb-1 text-gray-700">Tail</div>
            <select
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.tail}
              onChange={(e) => setDraft({ ...draft, tail: e.target.value })}
            >
              {TAILS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} ({t.id})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm md:col-span-2">
            <div className="mb-1 text-gray-700">Type</div>
            <select
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              <optgroup label="Minor">
                {MINOR_TYPES.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </optgroup>
              <optgroup label="Major">
                {MAJOR_TYPES.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="text-sm">
            <div className="mb-1 text-gray-700">Due date</div>
            <input
              type="date"
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.due}
              onChange={(e) => setDraft({ ...draft, due: e.target.value })}
            />
          </label>

          <label className="text-sm">
            <div className="mb-1 text-gray-700">Input</div>
            <input
              type="date"
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.input}
              onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            />
          </label>

          <label className="text-sm">
            <div className="mb-1 text-gray-700">Output</div>
            <input
              type="date"
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.output}
              onChange={(e) => setDraft({ ...draft, output: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-3">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.advReq}
              onChange={(e) => setDraft({ ...draft, advReq: e.target.checked })}
            />
            Adv required
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.advApproved}
              onChange={(e) => setDraft({ ...draft, advApproved: e.target.checked })}
            />
            Adv approved
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.extReq}
              onChange={(e) => setDraft({ ...draft, extReq: e.target.checked })}
            />
            Ext required
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.extApproved}
              onChange={(e) => setDraft({ ...draft, extApproved: e.target.checked })}
            />
            Ext approved
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.completed}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  completed: e.target.checked,
                  completedOn: e.target.checked ? todayISO() : "",
                })
              }
            />
            Completed
          </label>
          <label className="text-sm">
            <div className="mb-1 text-gray-700">Completed on</div>
            <input
              type="date"
              className="border rounded px-2 py-2 w-full text-sm"
              value={draft.completedOn}
              onChange={(e) => setDraft({ ...draft, completedOn: e.target.value })}
              disabled={!draft.completed}
            />
          </label>
        </div>

        <label className="text-sm block mt-3">
          <div className="mb-1 text-gray-700">Remarks</div>
          <textarea
            className="w-full min-h-[80px] border rounded p-2 text-sm"
            value={draft.remarks}
            onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
            placeholder="Notes, constraints, recovery window, etc."
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="px-3 py-2 text-sm bg-emerald-600 text-white rounded" onClick={addRow}>
            Add
          </button>
          <button className="px-3 py-2 text-sm border rounded" onClick={() => setDraft(EMPTY_ROW)}>
            Reset form
          </button>
          <button className="px-3 py-2 text-sm border rounded" onClick={onSaveLocal}>
            Save locally
          </button>
          <button className="px-3 py-2 text-sm border rounded" onClick={copyCSV}>
            Copy CSV
          </button>
        </div>
      </section>

      {/* MINOR table */}
      <section className="border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Minor servicing</div>
          <div className="text-xs text-gray-500">
            Due soon: ≤ 3 days • 56D alternates B → A → B • Sync with Night Report on Save to cloud
          </div>
        </div>
        <ServicingTable rows={minorRows} onChange={updateRow} onRemove={removeRow} />
      </section>

      {/* MAJOR table */}
      <section className="border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Major servicing</div>
          <div className="text-xs text-gray-500">
            Due soon: within 5% of planned days (min 5d) • Ext ≤ 5% w/o approval guideline
          </div>
        </div>
        <ServicingTable rows={majorRows} onChange={updateRow} onRemove={removeRow} />
      </section>
    </div>
  );
}

/** ====== Table component ====== */
function ServicingTable({ rows, onChange, onRemove }) {
  if (!rows?.length) return <div className="text-sm text-gray-500">No items.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <Th>Tail</Th>
            <Th>Type</Th>
            <Th>Due</Th>
            <Th>Status</Th>
            <Th>Input</Th>
            <Th>Output</Th>
            <Th>Adv</Th>
            <Th>Ext</Th>
            <Th>Completed</Th>
            <Th>Remarks</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.tail}</Td>
              <Td>{r.type}</Td>
              <Td>
                <input
                  type="date"
                  className="border rounded px-2 py-1"
                  value={r.due || ""}
                  onChange={(e) => onChange(r.id, { due: e.target.value })}
                />
              </Td>
              <Td>
                <StatusBadge state={r._state} />
              </Td>
              <Td>
                <input
                  type="date"
                  className="border rounded px-2 py-1"
                  value={r.input || ""}
                  onChange={(e) => onChange(r.id, { input: e.target.value })}
                />
              </Td>
              <Td>
                <input
                  type="date"
                  className="border rounded px-2 py-1"
                  value={r.output || ""}
                  onChange={(e) => onChange(r.id, { output: e.target.value })}
                />
              </Td>
              <Td>
                <label className="inline-flex items-center gap-1 mr-2">
                  <input
                    type="checkbox"
                    checked={!!r.advReq}
                    onChange={(e) => onChange(r.id, { advReq: e.target.checked })}
                  />
                  Req
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!r.advApproved}
                    onChange={(e) => onChange(r.id, { advApproved: e.target.checked })}
                  />
                  OK
                </label>
              </Td>
              <Td>
                <label className="inline-flex items-center gap-1 mr-2">
                  <input
                    type="checkbox"
                    checked={!!r.extReq}
                    onChange={(e) => onChange(r.id, { extReq: e.target.checked })}
                  />
                  Req
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!r.extApproved}
                    onChange={(e) => onChange(r.id, { extApproved: e.target.checked })}
                  />
                  OK
                </label>
              </Td>
              <Td>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!r.completed}
                    onChange={(e) =>
                      onChange(r.id, {
                        completed: e.target.checked,
                        completedOn: e.target.checked ? new Date().toISOString().slice(0, 10) : "",
                      })
                    }
                  />
                  {r.completed ? (
                    <input
                      type="date"
                      className="border rounded px-2 py-1"
                      value={r.completedOn || ""}
                      onChange={(e) => onChange(r.id, { completedOn: e.target.value })}
                    />
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </label>
              </Td>
              <Td>
                <textarea
                  className="border rounded px-2 py-1 w-56 h-16"
                  value={r.remarks || ""}
                  onChange={(e) => onChange(r.id, { remarks: e.target.value })}
                />
              </Td>
              <Td>
                <button className="text-red-600 underline" onClick={() => onRemove(r.id)}>
                  Delete
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left p-2 border-b">{children}</th>;
}
function Td({ children }) {
  return <td className="p-2 align-top">{children}</td>;
}
