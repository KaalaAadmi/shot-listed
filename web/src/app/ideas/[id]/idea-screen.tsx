"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { IdeaView } from "@/lib/ideas";
import type { Concept } from "@/lib/inspiration-rules.ts";
import { BriefEditor } from "./brief-editor";

async function call(method: string, path: string, body?: unknown): Promise<{ error: string | null; json: Record<string, unknown> }> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const json = res && res.status !== 204 ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
  return { error: res?.ok ? null : ((json.error as string | undefined) ?? "Something went wrong"), json };
}

const VERDICT = { make: "Looks good", twist: "Worth a twist", skip: "Weak" } as const;
const READY = { exploring: "Still exploring", almost: "Almost there", ready: "Ready for a brief" } as const;

export function IdeaScreen({ id }: { id: string }) {
  const router = useRouter();
  const [idea, setIdea] = useState<IdeaView | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/ideas/${id}`).then(async (r) => {
        if (r.status === 404) return setMissing(true);
        if (r.ok) setIdea((await r.json()) as IdeaView);
      }),
    [id],
  );

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  // The score arrives a little after the brief.
  const waitingForScore = !!idea?.brief && !idea.viability;
  useEffect(() => {
    if (!waitingForScore) return;
    const timer = setInterval(() => void load().catch(() => undefined), 3000);
    const stop = setTimeout(() => clearInterval(timer), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [waitingForScore, load]);

  async function run(label: string, fn: () => Promise<{ error: string | null; json: Record<string, unknown> }>, then?: (json: Record<string, unknown>) => void) {
    setBusy(label);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) setError(r.error);
    else then?.(r.json);
    await load().catch(() => undefined);
  }

  if (missing) return <p className="text-sm text-muted">That idea doesn&apos;t exist.</p>;
  if (!idea) return <p className="text-sm text-muted">Loading…</p>;

  const v = idea.viability;
  const planned = idea.status === "planned";
  const send = () =>
    run("chat", () => call("POST", `/api/ideas/${id}/messages`, { text: text.trim() }), () => setText(""));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/ideas" className="text-sm text-muted">
          ← Ideas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{idea.title}</h1>
        {idea.readiness && !idea.brief && <p className="text-sm text-muted">{READY[idea.readiness]}</p>}
      </div>

      {idea.messages.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {idea.messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className={`whitespace-pre-wrap ${m.role === "you" ? "self-end rounded-xl bg-accent-soft px-3 py-2" : "self-start rounded-xl border border-line bg-surface px-3 py-2"}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}

      {!planned && (
        <div className="flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={idea.messages.length ? "Reply…" : "Describe the idea…"} className="rounded-lg border border-line bg-background p-2.5 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy || !text.trim()} onClick={send} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium disabled:opacity-40">
              {busy === "chat" ? "Thinking…" : "Send"}
            </button>
            {idea.messages.length > 0 && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => run("brief", () => call("POST", `/api/ideas/${id}/brief`))}
                className={`rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40 ${idea.readiness === "ready" && !idea.brief ? "bg-foreground text-background" : "border border-line"}`}
              >
                {busy === "brief" ? "Making the brief…" : idea.brief ? "Make the brief again" : "Make the brief"}
              </button>
            )}
          </div>
        </div>
      )}

      {idea.brief && (
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">Brief {idea.briefSource === "pasted" ? "· read from what you pasted" : ""}</h2>

          {idea.assumptions && idea.assumptions.length > 0 && (
            <div className="text-sm">
              <p className="text-muted">Assumed, check these:</p>
              <ul className="list-disc pl-5">
                {idea.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {idea.questions && idea.questions.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted">Unclear. Fix the brief below, then dismiss:</p>
              {idea.questions.map((q) => (
                <div key={q} className="flex items-start justify-between gap-2">
                  <p>{q}</p>
                  <button
                    type="button"
                    disabled={!!busy || planned}
                    onClick={() => run("dismiss", () => call("PUT", `/api/ideas/${id}/brief`, { brief: idea.brief, questions: idea.questions!.filter((x) => x !== q) }))}
                    className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
          {idea.warnings.map((w) => (
            <p key={w} className="text-sm text-bad">
              {w}
            </p>
          ))}

          {v ? (
            <p className="text-sm">
              <span className="font-semibold">{VERDICT[v.verdict]}</span>
              <span className="text-muted"> · {v.score}/100 · for information only. </span>
              {v.reason}
              {v.twist ? <span className="text-muted"> Twist: {v.twist}</span> : null}
            </p>
          ) : (
            <p className="animate-pulse text-sm text-muted">Scoring…</p>
          )}

          {/* Remounts with fresh fields when the brief is remade. */}
          <BriefEditor key={idea.updatedAt} brief={idea.brief} busy={!!busy || planned} onSave={(c: Concept) => run("save", () => call("PUT", `/api/ideas/${id}/brief`, { brief: c, questions: idea.questions ?? [] }))} />

          {planned && idea.planId ? (
            <Link href={`/plans/${idea.planId}`} className="self-start rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background">
              Open plan
            </Link>
          ) : (
            <button
              type="button"
              disabled={!!busy || !!idea.questions?.length}
              onClick={() => run("plan", () => call("POST", `/api/ideas/${id}/plan`), (j) => router.push(`/plans/${String(j.planId)}`))}
              className="self-start rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40"
            >
              {busy === "plan" ? "Starting…" : "Make the plan"}
            </button>
          )}
        </section>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
