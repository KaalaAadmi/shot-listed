"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { NUMBER_FIELDS, numbersText, type Numbers, type PlanView } from "@/lib/plan-rules.ts";
import { uploadFile } from "@/lib/upload-client";

type Act = (fn: () => Promise<string | null>) => void;

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
}
const failure = async (res: Response) => (res.ok ? null : (((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong"));

/** Link the finished reel (captions see the plan), then mark it Posted with its numbers and add it to your history. */
export function PostSection({ plan, act }: { plan: PlanView; act: Act }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{ entry: string; tier: string; lesson: string } | null>(null);
  const [added, setAdded] = useState(false);
  const posted = plan.status === "posted";

  const upload = (file: File) =>
    act(async () => {
      setProgress(0);
      try {
        const { assetId } = await uploadFile(file, setProgress, undefined, { purpose: "final-cut" });
        return await failure(await send("POST", "/api/finals", { assetId, planId: plan._id }));
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      } finally {
        setProgress(null);
      }
    });

  const numbers = (): Numbers => Object.fromEntries(NUMBER_FIELDS.flatMap((k) => (typed[k]?.trim() ? [[k, Number(typed[k].replace(/,/g, ""))]] : []))) as Numbers;

  return (
    <section id="posted" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
      <h2 className="font-medium">Final cut and posting</h2>
      {plan.finalId ? (
        <Link href={`/finals/${plan.finalId}`} className="underline">
          Open the final cut and its captions
        </Link>
      ) : (
        <p className="text-muted">Upload the finished reel and its captions will know this plan&apos;s hooks and intent.</p>
      )}
      <button type="button" disabled={progress !== null} onClick={() => ref.current?.click()} className="self-start rounded-lg border border-line px-3 py-2">
        {progress === null ? (plan.finalId ? "Upload another cut" : "Upload the final cut") : `Uploading ${Math.round(progress * 100)}%`}
      </button>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />

      {!posted && (
        <>
          <p className="text-muted">Posted it? Type the numbers you have (any can be left blank).</p>
          <div className="grid grid-cols-3 gap-2">
            {NUMBER_FIELDS.map((k) => (
              <input key={k} inputMode="numeric" placeholder={k} value={typed[k] ?? ""} onChange={(e) => setTyped({ ...typed, [k]: e.target.value })} className="min-w-0 rounded-lg border border-line bg-background p-2" />
            ))}
          </div>
          <button type="button" onClick={() => act(async () => failure(await send("PATCH", `/api/plans/${plan._id}`, { status: "posted", numbers: numbers() })))} className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
            Mark Posted
          </button>
        </>
      )}

      {posted && (
        <>
          <p className="text-muted">Posted{plan.postedAt ? ` ${plan.postedAt.slice(0, 10)}` : ""} · {numbersText(plan.postedNumbers ?? {})}</p>
          {!draft && !added && (
            <button type="button" onClick={() => act(async () => {
              const res = await send("POST", `/api/plans/${plan._id}/history`);
              if (res.ok) setDraft((await res.json()) as { entry: string; tier: string; lesson: string });
              return failure(res);
            })} className="self-start rounded-lg border border-line px-3 py-2">
              Draft a history entry
            </button>
          )}
          {draft && (
            <>
              <p className="text-muted">
                Tier: {draft.tier} · {draft.lesson}
              </p>
              <textarea value={draft.entry} onChange={(e) => setDraft({ ...draft, entry: e.target.value })} rows={6} className="rounded-lg border border-line bg-background p-2.5" />
              <button type="button" onClick={() => act(async () => {
                const err = await failure(await send("PUT", `/api/plans/${plan._id}/history`, { entry: draft.entry }));
                if (!err) {
                  setDraft(null);
                  setAdded(true);
                }
                return err;
              })} className="self-start rounded-lg bg-foreground px-4 py-2 font-medium text-background">
                Add to history
              </button>
            </>
          )}
          {added && <p className="text-ok">Added to Settings → Content history.</p>}
        </>
      )}
    </section>
  );
}
