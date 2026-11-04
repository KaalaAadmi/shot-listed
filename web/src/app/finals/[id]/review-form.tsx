"use client";

import { useState } from "react";
import type { ReelDescription } from "@/lib/captions/engine";

const field = "rounded-lg border border-line bg-background p-2 text-sm";

/** The description as editable fields, so you can fix what the model misread before captions are written. */
export function ReviewForm({
  description,
  busy,
  onSubmit,
}: {
  description: ReelDescription;
  busy: boolean;
  onSubmit: (d: ReelDescription) => void;
}) {
  const [d, setD] = useState(description);
  const set = <K extends keyof ReelDescription>(k: K, v: ReelDescription[K]) => setD((p) => ({ ...p, [k]: v }));
  const setBeat = (i: number, patch: Partial<ReelDescription["beats"][number]>) =>
    set(
      "beats",
      d.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    );

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent bg-accent-soft p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Check the description</h2>
        <p className="text-muted">
          The captions are written from this. Fix anything the model misread, especially on-screen text and speech.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted">What the reel shows</span>
        <textarea value={d.plainDescription} onChange={(e) => set("plainDescription", e.target.value)} rows={3} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Hook (first 3 seconds)</span>
        <input value={d.hook} onChange={(e) => set("hook", e.target.value)} className={field} />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-muted">Shot by shot</span>
        {d.beats.map((b, i) => (
          <div key={i} className="flex flex-col gap-1 rounded-lg border border-line bg-background p-2">
            <span className="text-xs text-muted">
              <span className="font-mono">
                {b.start.toFixed(1)}–{b.end.toFixed(1)}s
              </span>{" "}
              {b.visual}
            </span>
            <input
              value={b.onScreenText}
              onChange={(e) => setBeat(i, { onScreenText: e.target.value })}
              placeholder="On-screen text"
              aria-label={`Beat ${i + 1} on-screen text`}
              className={field}
            />
            <input
              value={b.audio}
              onChange={(e) => setBeat(i, { audio: e.target.value })}
              placeholder="Speech or sound"
              aria-label={`Beat ${i + 1} speech or sound`}
              className={field}
            />
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted">All on-screen text, one per line</span>
        <textarea
          value={d.onScreenText.join("\n")}
          onChange={(e) => set("onScreenText", e.target.value.split("\n"))}
          rows={3}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Spoken words</span>
        <textarea value={d.spokenWords} onChange={(e) => set("spokenWords", e.target.value)} rows={2} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Call to action in the video</span>
        <input value={d.callToAction} onChange={(e) => set("callToAction", e.target.value)} className={field} />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit({ ...d, onScreenText: d.onScreenText.map((t) => t.trim()).filter(Boolean) })}
        className="self-start rounded-lg bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-50"
      >
        Write captions
      </button>
    </section>
  );
}
