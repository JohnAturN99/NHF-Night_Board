import React, { useMemo } from "react";
import { parseDailyRTS, parseWeeklyRTS } from "../utils/parsers/rts";

const chipMission = "inline-block text-xs px-2 py-1 rounded-md border bg-amber-100 border-amber-300 text-amber-900";
const chipSpare   = "inline-block text-xs px-2 py-1 rounded-md border bg-gray-100  border-gray-300  text-gray-700";
const chipHealing = "inline-block text-xs px-2 py-1 rounded-md border bg-blue-100  border-blue-300  text-blue-900";

export default function RTS({ rtsDailyRaw, setRtsDailyRaw, rtsWeekRaw, setRtsWeekRaw, loadDateAndSwitch }) {
  const daily = useMemo(() => (rtsDailyRaw ? parseDailyRTS(rtsDailyRaw) : null), [rtsDailyRaw]);
  const week  = useMemo(() => (rtsWeekRaw ? parseWeeklyRTS(rtsWeekRaw) : []), [rtsWeekRaw]);

  return (
    <>
      {/* DAILY */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">RTS — Daily</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="text-sm block mb-2">
              <span className="block text-gray-700 mb-1">Paste DAILY RTS</span>
              <textarea
                className="w-full min-h-[260px] border rounded-md p-3"
                value={rtsDailyRaw}
                onChange={(e) => setRtsDailyRaw(e.target.value)}
                placeholder={`13 Aug 25 (Wed) 🚁\n\nRTS:\nF3 1130 - 2200 GH/IF/ASUW/ASW/DIP\nS3 Spare\n\nHealing 🏥\nS2 1300 - 1400 FCF\n\nHot ⛽️\nF3 1415, 1715, 1845\n\nCold ⛽️\n2230\n\nOps Brief 🫱🫲:\n0900 & 1300\n\nNotes:\nS2: Profile A, Profile C, 1/rev, 4/rev\n...`}
              />
            </label>
          </div>

          <div className="border rounded-2xl p-4">
            {daily ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{daily.dateLabel}</div>
                  {daily.dateISO && (
                    <button className="text-xs underline text-blue-700" onClick={() => loadDateAndSwitch(daily.dateISO)}>
                      Load this date’s Night Report
                    </button>
                  )}
                </div>

                {daily.missions.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Missions</div>
                    <div className="flex flex-wrap gap-2">
                      {daily.missions.map((m, i) => (
                        <span key={i} className={chipMission}>
                          {m.code ? `${m.code} — ${m.label}` : m.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {daily.spares.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Spare</div>
                    <div className="flex flex-wrap gap-2">
                      {daily.spares.map((m, i) => (
                        <span key={i} className={chipSpare}>
                          {m.code ? `${m.code} — ${m.label}` : m.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {daily.healing.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Healing</div>
                    <div className="flex flex-wrap gap-2">
                      {daily.healing.map((h, i) => (
                        <span key={i} className={chipHealing}>
                          {h.code ? `${h.code} — ${h.label}` : h.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {daily.hot.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Hot ⛽️</div>
                    <div className="text-sm whitespace-pre-wrap">{daily.hot.join("\n")}</div>
                  </div>
                ) : null}
                {daily.cold.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Cold ⛽️</div>
                    <div className="text-sm whitespace-pre-wrap">{daily.cold.join("\n")}</div>
                  </div>
                ) : null}
                {daily.ops.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Ops Brief</div>
                    <div className="text-sm whitespace-pre-wrap">{daily.ops.join("\n")}</div>
                  </div>
                ) : null}
                {daily.notes.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-1">Notes</div>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {daily.notes.map((n, i) => <li key={i}>{n}</li>)}
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

      {/* WEEKLY */}
      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">RTS — Weekly Plan</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="text-sm block mb-2">
              <span className="block text-gray-700 mb-1">Paste WEEKLY RTS plan</span>
              <textarea
                className="w-full min-h-[320px] border rounded-md p-3"
                value={rtsWeekRaw}
                onChange={(e) => setRtsWeekRaw(e.target.value)}
                placeholder={`11 Aug - 15 Aug RTS\n---------------------------------\n\n11 Aug (Mon)\n\nS3 1100-1830 GH/ASUW/ASW\nS6 1230-1830 VIP/ASUW/ASW (ERC)\nS5 Spare (ERC)\n\nHealing:\nNil\n\nNotes:\nS2 Profile A, Profile C, 1/Rev, 4/Rev\n...`}
              />
            </label>
            <p className="text-xs text-gray-500">Missions are under each date, before Healing.</p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {week.length === 0 ? (
              <div className="text-sm text-gray-500 border rounded-md p-4">Paste a WEEKLY plan to preview.</div>
            ) : (
              week.map((day, idx) => (
                <div key={idx} className="border rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{day.dateLabel}</div>
                    {day.dateISO && (
                      <button className="text-xs underline text-blue-700" onClick={() => loadDateAndSwitch(day.dateISO)}>
                        Load this date’s Night Report
                      </button>
                    )}
                  </div>

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
  );
}
