"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AssetView, DuplicateVerdict } from "@/lib/types";

type Pair = {
  id: string;
  verdict: DuplicateVerdict;
  evidence: { secondsApart: number; hashDistance: number; sameBytes: boolean };
  betterFile: "keep" | "other";
  mergeAfter: string | null;
  keep: AssetView;
  other: AssetView;
};
type Data = { open: Pair[]; waiting: Pair[] };

function Thumb({ a, label }: { a: AssetView; label: string }) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
      <div className="aspect-[9/16] overflow-hidden rounded-md bg-line">
        {a.url &&
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, no optimiser
          (a.kind === "video" && !a.thumb ? <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={a.url} alt="" className="h-full w-full object-cover" />)}
      </div>
      <figcaption className="truncate">
        {label} · {a.filename} · {(a.size / 1024 ** 2).toFixed(1)} MB
      </figcaption>
    </figure>
  );
}

export function DuplicatesView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/media/duplicates");
    const body = await res.json();
    if (!res.ok) return setError(body.error ?? "Could not load duplicates");
    setError(null);
    setData(body as Data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount
    void load();
  }, [load]);

  async function act(id: string, action: "merge" | "keep-both" | "undo") {
    const res = await fetch(`/api/media/duplicates/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) setError((await res.json()).error ?? "That didn't work");
    await load();
  }

  const finals = data?.open.filter((p) => p.verdict === "final-cut") ?? [];
  const possible = data?.open.filter((p) => p.verdict !== "final-cut") ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/library" className="text-sm text-muted underline">
          ← Library
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
      </div>
      {error && <p className="rounded-lg border border-bad/40 p-3 text-sm text-bad">{error}</p>}
      {data && !data.open.length && !data.waiting.length && <p className="text-sm text-muted">Nothing to review.</p>}

      {possible.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Possible duplicates ({possible.length})</h2>
          {possible.map((p) => (
            <article key={p.id} className="flex flex-col gap-3 rounded-xl border border-line p-3">
              <div className="flex gap-3">
                <Thumb a={p.keep} label="Older" />
                <Thumb a={p.other} label="Newer" />
              </div>
              <p className="text-xs text-muted">
                {p.evidence.secondsApart}s apart · looks {p.evidence.hashDistance <= 6 ? "very" : "fairly"} alike. Merging keeps the {p.betterFile === "keep" ? "older" : "newer"}, better file.
              </p>
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={() => void act(p.id, "merge")} className="rounded-lg bg-accent px-3 py-1.5 text-white">
                  Merge
                </button>
                <button type="button" onClick={() => void act(p.id, "keep-both")} className="rounded-lg border border-line px-3 py-1.5">
                  Keep both
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {finals.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Possible: final cut ({finals.length})</h2>
          <p className="text-sm text-muted">These library videos match a final cut and are left out of plans until you decide.</p>
          {finals.map((p) => (
            <article key={p.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <div className="w-20">
                <Thumb a={p.other} label="Library" />
              </div>
              <button type="button" onClick={() => void act(p.id, "keep-both")} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm">
                It&apos;s footage, use it
              </button>
            </article>
          ))}
        </section>
      )}

      {data && data.waiting.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Merged soon ({data.waiting.length})</h2>
          <p className="text-sm text-muted">The newer copy is already hidden. It&apos;s merged for good after 7 days; Undo brings it back.</p>
          {data.waiting.map((p) => (
            <article key={p.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <div className="flex w-40 gap-2">
                <Thumb a={p.keep} label="Kept" />
                <Thumb a={p.other} label="Hidden" />
              </div>
              <span className="text-xs text-muted">{p.mergeAfter ? `Merges ${new Date(p.mergeAfter).toLocaleDateString()}` : ""}</span>
              <button type="button" onClick={() => void act(p.id, "undo")} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm">
                Undo
              </button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
