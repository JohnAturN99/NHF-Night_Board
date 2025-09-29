import React from "react";

export default function Generator({
  genSBirds, setGenSBirds,
  genFishing, setGenFishing,
  genHealing, setGenHealing,
  tgText, setTgText,
  onGenerate
}) {
  return (
    <>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold mb-2">HOTO quick inputs</h2>

          <label className="text-sm block mb-2">
            <span className="block text-gray-700 mb-1">Serviceable birds (comma-separated)</span>
            <input
              className="w-full border rounded-md p-2 text-sm"
              value={genSBirds}
              onChange={(e) => setGenSBirds(e.target.value)}
              placeholder="F2, F3, S3, S5, S6"
            />
          </label>

          <label className="text-sm block mb-2">
            <span className="block text-gray-700 mb-1">Fishing 🎣</span>
            <input
              className="w-full border rounded-md p-2 text-sm"
              value={genFishing}
              onChange={(e) => setGenFishing(e.target.value)}
              placeholder="Nil"
            />
          </label>

          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Healing ❤️‍🩹</span>
            <input
              className="w-full border rounded-md p-2 text-sm"
              value={genHealing}
              onChange={(e) => setGenHealing(e.target.value)}
              placeholder="Nil"
            />
          </label>

          <button className="mt-3 border rounded-md px-3 py-2 text-sm bg-emerald-600 text-white" onClick={onGenerate}>
            Generate Night Report from HOTO + Telegram
          </button>
          <p className="text-xs text-gray-500 mt-2">Fills the Overview editor.</p>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-2">Paste Telegram defects</h2>
          <textarea
            className="w-full min-h-[260px] border rounded-md p-3"
            value={tgText}
            onChange={(e) => setTgText(e.target.value)}
            placeholder="Paste Telegram defect updates here…"
          />
        </div>
      </section>
    </>
  );
}
