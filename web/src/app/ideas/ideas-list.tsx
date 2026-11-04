"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { IdeaSummary } from "@/lib/ideas";

const LABEL = { chatting: "Chatting", briefed: "Briefed", planned: "Planned", dropped: "Dropped" } as const;

export function IdeasList() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<IdeaSummary[] | null>(null);
  const [text, setText] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ideas")
      .then((r) => (r.ok ? r.json() : { ideas: [] }))
      .then((b: { ideas: IdeaSummary[] }) => setIdeas(b.ideas))
      .catch(() => setIdeas([]));
  }, []);

  async function start(body: { text: string } | { pasted: string }) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (json.id) router.push(`/ideas/${json.id}`);
    else setError(json.error ?? "Something went wrong");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
        <p className="text-sm text-muted">Describe a reel in your own words, talk it through, and turn it into a plan.</p>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="A gym reel where the rest timer is my anime power-up…" className="rounded-lg border border-line bg-background p-2.5 text-sm" />
        <button type="button" disabled={busy || !text.trim()} onClick={() => start({ text })} className="self-start rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40">
          {busy ? "Thinking…" : "New idea"}
        </button>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Paste a brief instead</summary>
          <div className="mt-2 flex flex-col gap-2">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder="Paste a brief from anywhere, in any layout." className="rounded-lg border border-line bg-background p-2.5 text-sm" />
            <button type="button" disabled={busy || !pasted.trim()} onClick={() => start({ pasted })} className="self-start rounded-lg border border-line px-4 py-2.5 text-sm font-medium disabled:opacity-40">
              {busy ? "Reading…" : "Read the brief"}
            </button>
          </div>
        </details>
        {error && <p className="text-sm text-bad">{error}</p>}
      </section>

      {ideas === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ideas.map((i) => (
            <li key={i.id}>
              <Link href={i.planId ? `/plans/${i.planId}` : `/ideas/${i.id}`} className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-4">
                <span className="font-medium">{i.title}</span>
                <span className="text-xs text-muted">{LABEL[i.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
