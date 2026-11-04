"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeForPrompt, type ReelDescription } from "@/lib/captions/engine";
import type { Draft } from "@/lib/captions/feedback";
import {
  cleanHashtags,
  formatForInstagram,
  hashtagLine,
  MAX_HASHTAGS,
  type HashtagPlacement,
} from "@/lib/captions/instagram-format";
import { copyText } from "@/lib/clipboard";
import type { FinalView, StepName } from "@/lib/types";
import { DraftPanel } from "./draft-panel";
import { ReviewForm } from "./review-form";

const STEPS: { name: StepName; label: string; running: string }[] = [
  { name: "watch", label: "Send to Gemini", running: "Sending the video" },
  { name: "describe", label: "Watch and describe", running: "Watching with sound" },
  { name: "review", label: "Check the description", running: "" },
  { name: "captions", label: "Write captions", running: "Writing three options" },
];

async function fetchFinal(id: string): Promise<FinalView | Error> {
  try {
    const res = await fetch(`/api/finals/${id}`);
    const body = (await res.json()) as { final?: FinalView; error?: string };
    return res.ok && body.final ? body.final : new Error(body.error ?? "Couldn't load");
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function descriptionText(f: FinalView): string {
  return f.description ? describeForPrompt(f.description, f.notes) : "";
}

/** "#gym, dublin  #expat" → ["#gym", "#dublin", "#expat"], keeping more than 5 so the editor can warn. */
function parseTags(input: string): string[] {
  return cleanHashtags(input.split(/[\s,]+/), 30);
}

export function FinalDetail({ id }: { id: string }) {
  const router = useRouter();
  const [final, setFinal] = useState<FinalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [placement, setPlacement] = useState<HashtagPlacement>("caption");
  const [spacer, setSpacer] = useState(false);
  const [direction, setDirection] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [showBeats, setShowBeats] = useState(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const apply = useCallback((result: FinalView | Error) => {
    if (result instanceof Error) {
      setError(result.message);
      return;
    }
    setError(null);
    setFinal(result);
    // Don't overwrite what you're typing with an older saved copy.
    if (!dirty.current) {
      setDraft(result.selected?.text ?? "");
      setTagsDraft(hashtagLine(result.selected?.hashtags ?? []));
    }
  }, []);

  // Load once, then keep polling while a step is running.
  useEffect(() => {
    let live = true;
    void fetchFinal(id).then((r) => live && apply(r));
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { hashtagPlacement?: HashtagPlacement; blankLineBeforeHashtags?: boolean } | null) => {
        if (!live || !s) return;
        if (s.hashtagPlacement) setPlacement(s.hashtagPlacement);
        setSpacer(!!s.blankLineBeforeHashtags);
      });
    return () => {
      live = false;
    };
  }, [id, apply]);

  const busy = final?.busy ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void fetchFinal(id).then(apply), 2000);
    return () => clearInterval(timer);
  }, [busy, id, apply]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function copy(text: string, what: string) {
    flash((await copyText(text)) ? `${what} copied` : "Couldn't copy; select and copy by hand");
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/finals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) apply(((await res.json()) as { final: FinalView }).final);
  }

  function choose(captionId: string) {
    const option = final?.captions?.options.find((o) => o.id === captionId);
    if (!option) return;
    dirty.current = false;
    clearTimeout(saveTimer.current);
    setDraft(option.text);
    setTagsDraft(hashtagLine(option.hashtags));
    void patch({ selected: { captionId, text: option.text, hashtags: option.hashtags } });
  }

  /** Saves your edits to the caption text or the hashtag line, a moment after you stop typing. */
  function edit(next: { text?: string; tags?: string }) {
    if (!final?.selected) return;
    dirty.current = true;
    const text = next.text ?? draft;
    const tags = next.tags ?? tagsDraft;
    setDraft(text);
    setTagsDraft(tags);
    clearTimeout(saveTimer.current);
    const captionId = final.selected.captionId;
    saveTimer.current = setTimeout(async () => {
      await patch({ selected: { captionId, text, hashtags: parseTags(tags) } });
      dirty.current = false;
    }, 800);
  }

  async function run(from?: StepName, description?: ReelDescription) {
    const res = await fetch(`/api/finals/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, description, direction: from === "captions" ? direction : undefined }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      flash(body.error ?? "Couldn't start");
      return;
    }
    dirty.current = false;
    apply(await fetchFinal(id));
  }

  async function saveDraft(d: Draft) {
    await patch({ draft: d });
  }

  /** Makes your own draft the caption that Copy caption uses. */
  function useDraft(text: string, hashtags: string[]) {
    dirty.current = false;
    clearTimeout(saveTimer.current);
    setDraft(text);
    setTagsDraft(hashtagLine(hashtags));
    void patch({ selected: { captionId: "draft", text, hashtags } });
    flash("Your draft is now the caption");
  }

  async function removeVideo() {
    if (!confirm("Delete the video from R2? The description and captions stay.")) return;
    const res = await fetch(`/api/finals/${id}/video`, { method: "DELETE" });
    if (res.ok) apply(await fetchFinal(id));
  }

  async function removeAll() {
    if (!confirm("Delete this final cut, its description and captions?")) return;
    const res = await fetch(`/api/finals/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/finals");
  }

  if (error && !final) return <p className="text-sm text-bad">{error}</p>;
  if (!final) return <p className="text-sm text-muted">Loading…</p>;

  const captions = final.captions;
  const tags = parseTags(tagsDraft);
  const formatted = formatForInstagram(draft, tags, placement, { blankLineBeforeHashtags: spacer });
  const firstComment = placement === "first-comment" ? hashtagLine(tags) : "";
  const failed = STEPS.find((s) => final.steps[s.name].status === "failed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/finals" className="text-sm text-muted">
          ← Captions
        </Link>
        <input
          defaultValue={final.title}
          key={final.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== final.title && void patch({ title: e.target.value.trim() })}
          aria-label="Title"
          className="-mx-1 rounded bg-transparent px-1 text-2xl font-semibold tracking-tight outline-none focus:bg-surface"
        />
      </div>

      {/* Live steps */}
      <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {STEPS.map((s) => {
          const st = final.steps[s.name];
          const style =
            st.status === "running"
              ? "border-accent bg-accent-soft"
              : st.status === "failed"
                ? "border-bad border-dashed"
                : st.status === "needs_you"
                  ? "border-accent"
                  : st.status === "done"
                    ? "border-line bg-surface"
                    : "border-line opacity-50";
          return (
            <li key={s.name} className={`flex flex-col gap-0.5 rounded-lg border p-3 ${style}`}>
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-muted">
                {st.status === "running" && `● ${s.running}…`}
                {st.status === "done" && `✓ Done${st.seconds !== null ? ` · ${st.seconds}s` : ""}`}
                {st.status === "waiting" && "Waiting"}
                {st.status === "needs_you" && <span className="font-medium text-accent">Needs you</span>}
                {st.status === "skipped" && "Skipped"}
                {st.status === "failed" && <span className="text-bad">Failed</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {failed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 p-3 text-sm">
          <span className="min-w-0 flex-1 text-bad">{final.steps[failed.name].error ?? "Something went wrong"}</span>
          <button type="button" onClick={() => void run()} className="font-medium text-accent">
            Retry from here
          </button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,260px)_1fr]">
        {/* Video */}
        <div className="flex flex-col gap-2">
          {final.video?.url ? (
            <video src={final.video.url} controls playsInline className="aspect-[9/16] w-full rounded-lg bg-black" />
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
              Video deleted. The description and captions are kept.
            </div>
          )}
          {final.video && (
            <button type="button" onClick={() => void removeVideo()} disabled={busy} className="text-left text-xs text-muted underline">
              Delete video to free {(final.video.size / 1024 ** 2).toFixed(0)} MB (keep captions)
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Description check: pauses here until you carry on */}
          {final.description && final.steps.review.status === "needs_you" && (
            <ReviewForm description={final.description} busy={busy} onSubmit={(d) => void run("captions", d)} />
          )}

          {/* Description */}
          {final.description && final.steps.review.status !== "needs_you" && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium">Description</h2>
                <button type="button" onClick={() => void copy(descriptionText(final), "Description")} className="text-sm font-medium text-accent">
                  Copy description
                </button>
              </div>
              <p className="text-sm">{final.description.plainDescription}</p>
              <p className="text-sm text-muted">
                <span className="font-medium text-foreground">Hook:</span> {final.description.hook}
              </p>
              <button type="button" onClick={() => setShowBeats((v) => !v)} className="self-start text-xs text-muted underline">
                {showBeats ? "Hide" : "Show"} shot-by-shot
              </button>
              {showBeats && (
                <ol className="flex flex-col gap-1 text-xs text-muted">
                  {final.description.beats.map((b, i) => (
                    <li key={i}>
                      <span className="font-mono">
                        {b.start.toFixed(1)}–{b.end.toFixed(1)}s
                      </span>{" "}
                      {b.visual}
                      {b.onScreenText && <> · text “{b.onScreenText}”</>}
                      {b.audio && <> · {b.audio}</>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {/* Honest review first: worth knowing before you pick a caption */}
          {captions && (captions.feedback.rating || captions.trial.reason) && (
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">Review</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    captions.trial.recommended ? "bg-accent text-white" : "border border-line text-muted"
                  }`}
                >
                  {captions.trial.recommended ? "Post as a Trial" : "Share to everyone"}
                </span>
              </div>
              {captions.feedback.rating && <p className="font-medium">{captions.feedback.rating}</p>}
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                {captions.feedback.mostSimilarReel && (
                  <>
                    <dt className="text-muted">Most like</dt>
                    <dd>{captions.feedback.mostSimilarReel}</dd>
                  </>
                )}
                {captions.feedback.lesson && (
                  <>
                    <dt className="text-muted">Lesson</dt>
                    <dd>{captions.feedback.lesson}</dd>
                  </>
                )}
                {captions.feedback.improvement && (
                  <>
                    <dt className="text-muted">Improve</dt>
                    <dd>{captions.feedback.improvement}</dd>
                  </>
                )}
                {captions.trial.reason && (
                  <>
                    <dt className="text-muted">Trial</dt>
                    <dd>{captions.trial.reason}</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {/* Caption options */}
          {captions && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">Pick a caption</h2>
                <span className="text-xs text-muted">Written by {captions.writtenBy}</span>
              </div>
              <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Caption options">
                {captions.options.map((o) => {
                  const chosen = final.selected?.captionId === o.id;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        onClick={() => choose(o.id)}
                        className={`flex w-full flex-col gap-2 rounded-xl border p-4 text-left ${
                          chosen ? "border-accent bg-accent-soft" : "border-line bg-surface"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold">{o.angle}</span>
                          {o.recommended && (
                            <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-white">Recommended</span>
                          )}
                          {o.keywords.map((k) => (
                            <span key={k} className="rounded-full border border-line px-2 py-0.5 text-muted">
                              {k}
                            </span>
                          ))}
                        </span>
                        <span className="whitespace-pre-wrap text-sm">{o.text}</span>
                        {o.hashtags.length > 0 && <span className="text-sm text-muted">{hashtagLine(o.hashtags)}</span>}
                        {o.recommended && captions.recommendedWhy && (
                          <span className="text-xs text-muted">Why: {captions.recommendedWhy}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {captions.keywordsWoven.length > 0 && (
                <div className="flex flex-col gap-1 rounded-xl border border-line p-3 text-sm">
                  <span className="font-medium">Keywords woven in</span>
                  <ul className="flex flex-col gap-0.5">
                    {captions.keywordsWoven.map((k) => (
                      <li key={k.phrase}>
                        “{k.phrase}” <span className="text-muted">· {k.where}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">Not quite? Give direction and write a new round</span>
                  <input
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder="e.g. drier, lean into the anime angle, mention Dublin rain"
                    className="rounded-lg border border-line bg-background p-2"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void run("captions")}
                  disabled={busy}
                  className="rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  New captions
                </button>
              </div>
            </section>
          )}

          <DraftPanel
            key={final.captions?.options[0]?.id}
            final={final}
            placement={placement}
            spacer={spacer}
            save={saveDraft}
            onFinal={apply}
            onUse={useDraft}
          />

          {/* Editor, preview and copy */}
          {captions && final.selected && (
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
              <h2 className="font-medium">Your caption</h2>
              <textarea
                value={draft}
                onChange={(e) => edit({ text: e.target.value })}
                rows={6}
                aria-label="Edit the selected caption"
                className="rounded-lg border border-line bg-background p-3 text-sm"
              />
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Hashtags (up to {MAX_HASHTAGS})</span>
                <input
                  value={tagsDraft}
                  onChange={(e) => edit({ tags: e.target.value })}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="rounded-lg border border-line bg-background p-2"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">As it will appear on Instagram</span>
                <div className="whitespace-pre-wrap rounded-lg border border-line bg-background p-3 text-sm">{formatted.text}</div>
                <span className="text-xs text-muted">
                  {formatted.charCount} / 2,200 characters · {tags.length} / {MAX_HASHTAGS} hashtags
                  {placement === "first-comment" && " (hashtags go in the first comment)"}
                </span>
                {placement === "first-comment" && tags.length > MAX_HASHTAGS && (
                  <span className="text-xs text-bad">
                    {tags.length} hashtags; Instagram allows {MAX_HASHTAGS} per post.
                  </span>
                )}
                {formatted.warnings.map((w) => (
                  <span key={w} className="text-xs text-bad">
                    {w}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copy(formatted.text, "Caption")}
                  className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Copy caption
                </button>
                <button
                  type="button"
                  onClick={() => void copy(hashtagLine(tags), "Hashtags")}
                  className="rounded-lg border border-line px-3 py-2.5 text-sm"
                >
                  Copy hashtags
                </button>
                {firstComment && (
                  <button
                    type="button"
                    onClick={() => void copy(firstComment, "First comment")}
                    className="rounded-lg border border-line px-3 py-2.5 text-sm"
                  >
                    Copy first comment
                  </button>
                )}
              </div>
              <p className="text-xs text-muted">
                The copy carries every line break, so you can paste it straight into Instagram without adding any.
                Blank lines hold an invisible character so Instagram keeps them. Paste it whole; editing the spacing
                inside Instagram can undo it.
              </p>
            </section>
          )}

          <button type="button" onClick={() => void removeAll()} disabled={busy} className="self-start text-xs text-bad underline">
            Delete this final cut
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center" role="status">
          <span className="rounded-full bg-foreground px-4 py-2 text-sm text-background shadow">{toast}</span>
        </div>
      )}
    </div>
  );
}
