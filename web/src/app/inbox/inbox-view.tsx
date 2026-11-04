"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InspirationView } from "@/lib/types";
import { uploadFile } from "@/lib/upload-client";

const VERDICT = {
  make: { label: "Make now", tone: "text-ok" },
  twist: { label: "Make with a twist", tone: "text-foreground" },
  skip: { label: "Skip", tone: "text-bad" },
} as const;

async function post(path: string, body?: unknown): Promise<string | null> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong";
}

/** Make creates the plan; the card then shows "Open plan". */
const make = (id: string) => post(`/api/inspirations/${id}/make`);

function Progress({ steps }: { steps: InspirationView["steps"] }) {
  return (
    <ol className="flex gap-1.5 text-xs">
      {steps.map((s) => (
        <li key={s.name} className="flex flex-1 flex-col gap-1">
          <span
            className={`h-1.5 rounded-full ${
              s.status === "done" || s.status === "skipped" ? "bg-ok" : s.status === "running" ? "animate-pulse bg-accent" : s.status === "failed" ? "bg-bad" : "bg-line"
            }`}
          />
          <span className={s.status === "running" ? "text-foreground" : "text-muted"}>{s.name}</span>
        </li>
      ))}
    </ol>
  );
}

function Card({ r, reload }: { r: InspirationView; reload: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = r.viability;

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    setBusy(false);
    if (err) setError(err);
    else reload();
  }

  const upload = (file: File) =>
    run(async () => {
      const { assetId } = await uploadFile(file, () => undefined, undefined, { purpose: "inspiration" });
      return post(`/api/inspirations/${r.id}/file`, { assetId });
    });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">{r.title}</h2>
        <p className="truncate text-xs text-muted">
          {r.creator ? `@${r.creator} · ` : ""}
          {r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="underline">
              Open on Instagram
            </a>
          ) : (
            "Uploaded by hand"
          )}
          {r.note ? ` · “${r.note}”` : ""}
        </p>
      </div>

      {!v && <Progress steps={r.steps} />}

      {v && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className={`font-semibold ${VERDICT[v.verdict].tone}`}>{VERDICT[v.verdict].label}</span>
            <span className="text-muted"> · {v.score}/100{r.overridden ? " · made anyway" : ""}</span>
          </p>
          <p>{v.reason}</p>
          {v.vetoedBy && <p className="text-muted">You posted something like this recently{v.similarRecentPost ? `: ${v.similarRecentPost}` : ""}.</p>}
          {v.twist && <p className="text-muted">Twist: {v.twist}</p>}
          <details className="text-muted">
            <summary className="cursor-pointer">Why this score</summary>
            <ul className="mt-1 list-disc pl-5">
              <li>Fits you {v.factors.nicheFit}/10: {v.why.nicheFit}</li>
              <li>Clips you already have {v.factors.clipCoverage.toFixed(0)}/10</li>
              <li>Easy to make {v.factors.effort}/10: {v.why.effort}</li>
              <li>Fresh format {v.factors.formatFreshness}/10: {v.why.formatFreshness}</li>
              <li>Shareable {v.factors.sharePotential}/10: {v.why.sharePotential}</li>
            </ul>
          </details>
        </div>
      )}

      {r.status === "failed" && (
        <p className="text-sm text-bad">{r.error ?? "Something failed."}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {r.status === "failed" && (
          <button type="button" disabled={busy} onClick={() => run(() => post(`/api/inspirations/${r.id}/retry`))} className="rounded-lg border border-line px-3 py-2 text-sm">
            Retry
          </button>
        )}
        {r.status === "failed" && !r.hasVideo && r.source === "share" && (
          <>
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-2 text-sm">
              Upload the video instead
            </button>
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </>
        )}
        {r.planId && (
          <Link href={`/plans/${r.planId}`} className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">
            Open plan
          </Link>
        )}
        {v && !r.planId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => make(r.id))}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${v.verdict === "skip" ? "border border-line" : "bg-foreground text-background"}`}
          >
            {v.verdict === "skip" && !r.overridden ? "Make anyway" : "Make"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </li>
  );
}

export function InboxView() {
  const [items, setItems] = useState<InspirationView[] | null>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/inspirations")
        .then((r) => (r.ok ? r.json() : { inspirations: [] }))
        .then((b: { inspirations: InspirationView[] }) => setItems(b.inspirations))
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function add() {
    setError(null);
    const err = await post("/api/inspirations", { url: link, note });
    if (err) return setError(err);
    setLink("");
    setNote("");
    void load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted">
          Reels you shared from Instagram. Each is downloaded, watched with sound and scored for your account. You can also paste a link here.
        </p>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" className="rounded-lg border border-line bg-background p-2.5 text-sm" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="rounded-lg border border-line bg-background p-2.5 text-sm" />
        <div className="flex items-center gap-3">
          <button type="button" disabled={!link.trim()} onClick={add} className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40">
            Add reel
          </button>
          {error && <span className="text-sm text-bad">{error}</span>}
        </div>
      </section>

      {items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing here yet. Share a reel from Instagram with the ShotListed Shortcut.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <Card key={r.id} r={r} reload={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
