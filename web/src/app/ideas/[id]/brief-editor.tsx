"use client";

import { useState } from "react";
import type { Concept } from "@/lib/inspiration-rules.ts";

const input = "w-full rounded-lg border border-line bg-background p-2 text-sm";

/** Every field of the brief is editable; Save sends the lot back and the server renumbers the beats. */
export function BriefEditor({ brief, busy, onSave }: { brief: Concept; busy: boolean; onSave: (c: Concept) => void }) {
  const [c, setC] = useState<Concept>(brief);
  const set = <K extends keyof Concept>(k: K, v: Concept[K]) => setC((p) => ({ ...p, [k]: v }));
  const beat = (i: number, patch: Partial<Concept["beats"][number]>) => set("beats", c.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const terms = c.audio.searchTerms.join(", ");

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted">Title</span>
        <input className={input} value={c.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Format</span>
          <input className={input} value={c.format} onChange={(e) => set("format", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Seconds</span>
          <input className={input} type="number" min={1} value={c.lengthSeconds} onChange={(e) => set("lengthSeconds", Number(e.target.value))} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Hook (first 1–2 seconds)</span>
        <textarea className={input} rows={2} value={c.hook} onChange={(e) => set("hook", e.target.value)} />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-muted">Shots</span>
        {c.beats.map((b, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{i + 1}</span>
              <input className={`${input} w-20`} type="number" min={0.5} step={0.5} value={b.seconds} onChange={(e) => beat(i, { seconds: Number(e.target.value) })} aria-label={`Shot ${i + 1} seconds`} />
              <span className="text-muted">s</span>
              <button type="button" onClick={() => set("beats", c.beats.filter((_, j) => j !== i))} className="ml-auto text-xs text-muted underline">
                Remove
              </button>
            </div>
            <textarea className={input} rows={2} value={b.shows} onChange={(e) => beat(i, { shows: e.target.value })} placeholder="What it shows" aria-label={`Shot ${i + 1} shows`} />
            <input className={input} value={b.onScreenText} onChange={(e) => beat(i, { onScreenText: e.target.value })} placeholder="On-screen text" aria-label={`Shot ${i + 1} text`} />
            <input className={input} value={b.spoken} onChange={(e) => beat(i, { spoken: e.target.value })} placeholder="Spoken" aria-label={`Shot ${i + 1} speech`} />
          </div>
        ))}
        <button type="button" onClick={() => set("beats", [...c.beats, { n: c.beats.length + 1, seconds: 2, shows: "", onScreenText: "", spoken: "", sound: "" }])} className="self-start rounded-lg border border-line px-3 py-2">
          Add a shot
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted">Sound idea</span>
        <input className={input} value={c.audio.idea} onChange={(e) => set("audio", { ...c.audio, idea: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Search terms (comma separated)</span>
        <input className={input} defaultValue={terms} onBlur={(e) => set("audio", { ...c.audio, searchTerms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Why it should work</span>
        <textarea className={input} rows={2} value={c.why} onChange={(e) => set("why", e.target.value)} />
      </label>

      <button type="button" disabled={busy} onClick={() => onSave({ ...c, onScreenText: c.beats.map((b) => b.onScreenText).filter(Boolean) })} className="self-start rounded-lg border border-line px-4 py-2.5 font-medium disabled:opacity-40">
        Save changes
      </button>
    </div>
  );
}
