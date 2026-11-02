"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FinalView } from "@/lib/types";
import { uploadFile } from "@/lib/upload-client";

function statusOf(f: FinalView): { label: string; tone: "busy" | "ok" | "bad" | "idle" } {
  const steps = Object.values(f.steps);
  if (steps.some((s) => s.status === "failed")) return { label: "Needs a retry", tone: "bad" };
  if (f.busy) return { label: "Writing…", tone: "busy" };
  if (f.captions) return { label: "Captions ready", tone: "ok" };
  return { label: "Waiting", tone: "idle" };
}

const TONE = {
  busy: "bg-accent-soft text-foreground",
  ok: "text-ok",
  bad: "text-bad",
  idle: "text-muted",
};

export function FinalsView() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  /** Set while the file is being hashed, before the upload starts. */
  const [checking, setChecking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finals, setFinals] = useState<FinalView[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/finals")
        .then((r) => (r.ok ? r.json() : { finals: [] }))
        .then((b: { finals: FinalView[] }) => live && setFinals(b.finals))
        .catch(() => undefined);
    void load();
    // Refresh while anything is still being written.
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  async function start() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const { assetId } = await uploadFile(file, setProgress, undefined, {
        purpose: "final-cut",
        onChecking: (c) => setChecking(c < 1 ? c : null),
      });
      const res = await fetch("/api/finals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, notes }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't start");
      router.push(`/finals/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
      setChecking(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Captions</h1>
        <p className="text-sm text-muted">
          Upload the reel you exported from Edits. It gets watched with sound and described, then your Social Media
          Manager prompt writes three caption options with hashtags, keywords, a pick, honest feedback and Trial
          advice.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={progress !== null}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium"
          >
            {file ? "Choose a different video" : "Choose your final cut"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mov,.mp4"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <span className="min-w-0 truncate text-sm text-muted">
              {file.name} · {(file.size / 1024 ** 2).toFixed(1)} MB
            </span>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Anything the captions should know (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. filmed at my gym in Dublin; comment keyword WINTER; link in bio"
            className="rounded-lg border border-line bg-background p-2.5"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={!file || progress !== null}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {progress === null
              ? "Upload and write captions"
              : checking !== null
                ? `Checking ${Math.round(checking * 100)}%`
                : `Uploading ${Math.round(progress * 100)}%`}
          </button>
          {progress !== null && <span className="text-sm text-muted">Keep this tab open</span>}
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Recent</h2>
        {finals === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : finals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            Nothing yet. Your first final cut will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {finals.map((f) => {
              const s = statusOf(f);
              return (
                <li key={f.id}>
                  <Link href={`/finals/${f.id}`} className="flex items-center gap-3 p-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.title}</span>
                      <span className="text-xs text-muted">{new Date(f.createdAt).toLocaleString()}</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[s.tone]}`}>{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
