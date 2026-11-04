"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { isLongText, totalSeconds, type PlanShot, type PlanView } from "@/lib/plan-rules.ts";
import { uploadFile } from "@/lib/upload-client";
import { Pipeline } from "./pipeline";
import { PostSection } from "./post-section";

async function post(path: string, body?: unknown): Promise<string | null> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong";
}

async function put(path: string, body: unknown): Promise<string | null> {
  const res = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong";
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        setDone(await copyText(text));
        setTimeout(() => setDone(false), 1500);
      }}
      className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

type Clips = PlanView["clips"];

function Clip({ id, clips }: { id: string; clips: Clips }) {
  const c = clips[id];
  if (!c?.url) return <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-line text-xs text-muted">No preview</div>;
  // A video with a thumbnail shows the thumbnail; one without plays the original.
  return c.kind === "video" && !c.thumb ? (
    <video src={c.url} muted playsInline controls className="aspect-[9/16] w-full rounded-lg bg-line object-cover" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.url} alt="" className="aspect-[9/16] w-full rounded-lg bg-line object-cover" />
  );
}

const VERDICT = { checking: "Checking…", pass: "Pass", usable: "Usable", reshoot: "Reshoot", failed: "Couldn't check" } as const;

/** Upload a video for this card as a library item, then ask for it to be checked. */
function Takes({ planId, s, act }: { planId: string; s: PlanShot; act: (fn: () => Promise<string | null>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = (file: File) =>
    act(async () => {
      setProgress(0);
      try {
        const { assetId } = await uploadFile(file, setProgress);
        return await post(`/api/plans/${planId}/shots/${s.id}/takes`, { assetId });
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      } finally {
        setProgress(null);
      }
    });
  return (
    <div className="flex flex-col gap-2">
      {s.takes.map((t) => (
        <div key={t.libraryItemId} className="flex flex-col gap-1 rounded-lg bg-background p-3 text-sm">
          <p>
            <span className={`font-medium ${t.verdict === "pass" ? "text-ok" : t.verdict === "reshoot" ? "text-bad" : ""}`}>{VERDICT[t.verdict]}</span>
            {t.overridden ? <span className="text-muted"> · used anyway</span> : null}
          </p>
          {t.fix && <p>{t.fix}</p>}
          {t.notes && t.verdict !== "checking" && <p className="text-muted">{t.notes}</p>}
          {t.verdict !== "checking" && !(s.source === "library" && s.libraryItemId === t.libraryItemId) && (
            <button type="button" onClick={() => act(() => put(`/api/plans/${planId}/shots/${s.id}/takes`, { assetId: t.libraryItemId }))} className="self-start rounded-md border border-line px-2 py-1 text-xs">
              Use anyway
            </button>
          )}
        </div>
      ))}
      <button type="button" disabled={progress !== null} onClick={() => ref.current?.click()} className="self-start rounded-lg border border-line px-3 py-2 text-sm">
        {progress === null ? "Upload a take" : `Uploading ${Math.round(progress * 100)}%`}
      </button>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </div>
  );
}

function Shot({ planId, s, clips, act }: { planId: string; s: PlanShot; clips: Clips; act: (fn: () => Promise<string | null>) => void }) {
  const f = s.filmIt;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">
          Shot {s.n} · {s.seconds} s
        </h3>
        <span className="text-xs text-muted">{s.source === "library" ? `Your clip · ${s.fit}` : s.source === "stock" ? "Stock" : "Film it"}</span>
      </div>
      <p className="text-sm text-muted">{s.beat}</p>
      {s.searching && <p className="animate-pulse text-sm text-accent">Looking for a clip…</p>}
      {s.note && <p className="text-sm">{s.note}</p>}

      {s.source === "library" && s.libraryItemId && (
        <div className="flex gap-3">
          <div className="w-28 shrink-0">
            <Clip id={s.libraryItemId} clips={clips} />
          </div>
          <p className="text-sm text-muted">
            {s.label}
            {s.why ? ` · ${s.why}` : ""}
            {s.in !== undefined && s.out !== undefined ? ` · ${s.in}–${s.out} s` : ""}
          </p>
        </div>
      )}

      {s.source === "stock" && s.stock && (
        <p className="text-sm">
          <a href={s.stock.url} target="_blank" rel="noreferrer" className="underline">
            Stock clip on Pexels
          </a>
          <span className="text-muted"> · {s.stock.credit}</span>
        </p>
      )}

      {s.source === "film_it" && f && f.recordSeconds > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-background p-3 text-sm">
          {(
            [
              ["Where", f.where],
              ["Framing", f.framing],
              ["Lens", f.lens],
              ["Movement", f.movement],
              ["Text space", f.textSpace],
              ["Light and sound", f.lightSound],
              ["Record", `${f.recordSeconds} s × ${f.takes} take${f.takes === 1 ? "" : "s"}`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {(s.filmIt || s.takes.length > 0) && <Takes planId={planId} s={s} act={act} />}

      {s.alternates.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">Other clips (tap to use)</p>
          <div className="flex gap-2 overflow-x-auto">
            {s.alternates.map((a, i) => (
              <button
                key={a.libraryItemId}
                type="button"
                disabled={a.fit === "weak"}
                onClick={() => act(() => post(`/api/plans/${planId}/shots/${s.id}/alternate`, { alternate: i + 1 }))}
                className="flex w-24 shrink-0 flex-col gap-1 text-left text-xs disabled:opacity-40"
              >
                <Clip id={a.libraryItemId} clips={clips} />
                <span className="text-muted">{a.fit}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {s.onScreenText && (
        <div className="flex items-start justify-between gap-2 text-sm">
          <p>
            <span className="text-muted">On screen ({s.textPosition}): </span>
            {s.onScreenText}
            {isLongText(s.onScreenText) && <span className="text-bad"> · long for {s.seconds} s</span>}
          </p>
          <Copy text={s.onScreenText} label={`shot ${s.n} text`} />
        </div>
      )}
    </li>
  );
}

export function PlanScreen({ id }: { id: string }) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(
    () =>
      fetch(`/api/plans/${id}`)
        .then(async (r) => {
          if (r.status === 404) return setMissing(true);
          if (r.ok) setPlan((await r.json()) as PlanView);
        })
        .catch(() => undefined),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const working = plan?.build === "building" || !!plan?.shots.some((s) => s.searching || s.takes.some((t) => t.verdict === "checking")) || plan?.clipPack.status === "building";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [working, load]);

  async function act(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    setBusy(false);
    if (err) setError(err);
    await load();
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    setError(null);
    const err = await post(`/api/plans/${id}/messages`, { text: t }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    setSending(false);
    if (err) return setError(err);
    setText("");
    await load();
  }

  if (missing) return <p className="text-sm text-muted">That plan doesn&apos;t exist.</p>;
  if (!plan) return <p className="text-sm text-muted">Loading…</p>;

  const wrap = (fn: () => Promise<string | null>) => void act(fn);
  const ready = plan.build === "ready";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/plans" className="text-sm text-muted">
          ← Plans
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{plan.title}</h1>
        <p className="text-sm text-muted">
          {plan.format} · {totalSeconds(plan.shots)} s · {plan.shots.length} shots
          {plan.shootDay ? " · Shoot day" : ""}
        </p>
      </div>

      <Pipeline plan={plan} busy={busy} onRetry={(from) => wrap(() => post(`/api/plans/${id}/rerun`, { from }))} />

      {plan.build === "building" && <p className="animate-pulse text-sm text-accent">Building your plan…</p>}
      {plan.build === "failed" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-bad">{plan.error ?? "Something failed."}</p>
          <button type="button" disabled={busy} onClick={() => wrap(() => post(`/api/plans/${id}/rerun`, { from: "matching" }))} className="self-start rounded-lg border border-line px-3 py-2 text-sm">
            Retry
          </button>
        </div>
      )}

      {ready && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Hooks</h2>
            <ul className="flex flex-col gap-2">
              {plan.hooks.map((h) => (
                <li key={h.text} className="flex items-start justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
                  <p>
                    {h.text}
                    <span className="text-muted"> · {h.style}</span>
                  </p>
                  <Copy text={h.text} label="hook" />
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Shots</h2>
            <ol className="flex flex-col gap-3">
              {plan.shots.map((s) => (
                <Shot key={s.id} planId={id} s={s} clips={plan.clips} act={wrap} />
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-medium">Clip pack</h2>
            <p className="text-muted">Your clips, trimmed with a little room either side and numbered in shot order, in one zip for Edits.</p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy || plan.clipPack.status === "building"} onClick={() => wrap(() => post(`/api/plans/${id}/pack`))} className="rounded-lg border border-line px-3 py-2">
                {plan.clipPack.status === "building" ? "Making it…" : plan.clipPack.status === "ready" ? "Make it again" : "Make the clip pack"}
              </button>
              {plan.clipPack.status === "ready" && plan.packUrl && (
                <a href={plan.packUrl} className="underline">
                  Download
                </a>
              )}
              {plan.clipPack.status === "failed" && <span className="text-bad">That didn&apos;t work. Try again.</span>}
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-medium">Audio</h2>
            <p>{plan.audio.vibe}</p>
            {plan.audio.note && <p className="text-muted">{plan.audio.note}</p>}
            <p className="text-muted">
              {plan.audio.useInspirationSound && plan.audio.inspiration.title && plan.audio.inspiration.title !== "unknown" ? (
                <>Use the original sound{plan.audio.inspiration.url ? <> · <a href={plan.audio.inspiration.url} target="_blank" rel="noreferrer" className="underline">{plan.audio.inspiration.title}</a></> : ` · ${plan.audio.inspiration.title}`}. </>
              ) : null}
              Search Instagram for: {plan.audio.searchTerms.join(", ") || "any trending sound that fits"}
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-medium">Edit notes</h2>
            <ul className="list-disc pl-5">
              {plan.editNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>

          <PostSection plan={plan} act={wrap} />

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Change the plan</h2>
              <button type="button" disabled={busy || !plan.canUndo} onClick={() => wrap(() => post(`/api/plans/${id}/undo`))} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40">
                Undo
              </button>
            </div>
            {plan.chat.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm">
                {plan.chat.map((t, i) => (
                  <li key={`${t.at}-${i}`} className={t.role === "you" ? "self-end rounded-xl bg-accent-soft px-3 py-2" : "self-start rounded-xl border border-line bg-surface px-3 py-2"}>
                    {t.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !sending && void send()}
                placeholder="Make shot 3 longer, swap in a different clip…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-background p-2.5 text-sm"
              />
              <button type="button" disabled={sending || !text.trim() || working} onClick={send} className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40">
                {sending ? "…" : "Send"}
              </button>
            </div>
          </section>
        </>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
