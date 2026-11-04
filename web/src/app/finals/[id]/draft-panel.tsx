"use client";

import { useRef, useState } from "react";
import { applySuggestion, type Draft, type FeedbackTurn } from "@/lib/captions/feedback";
import {
  cleanHashtags,
  formatForInstagram,
  hashtagLine,
  MAX_HASHTAGS,
  type HashtagPlacement,
} from "@/lib/captions/instagram-format";
import type { FinalView } from "@/lib/types";

const parseTags = (s: string) => cleanHashtags(s.split(/[\s,]+/), 30);
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const btn = "rounded border border-line px-2 py-1 text-xs";

/** Your own caption built from the options, with feedback from the model. */
export function DraftPanel({
  final,
  placement,
  spacer,
  save,
  onFinal,
  onUse,
}: {
  final: FinalView;
  placement: HashtagPlacement;
  spacer: boolean;
  save: (d: Draft) => Promise<void>;
  onFinal: (f: FinalView) => void;
  onUse: (text: string, hashtags: string[]) => void;
}) {
  const captions = final.captions;
  const [lines, setLines] = useState(final.draft?.lines ?? []);
  const [tags, setTags] = useState(hashtagLine(final.draft?.hashtags ?? []));
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const draft: Draft = { lines, hashtags: parseTags(tags) };
  const formatted = formatForInstagram(lines.join("\n"), draft.hashtags, placement, { blankLineBeforeHashtags: spacer });

  function update(next: Draft) {
    setLines(next.lines);
    setTags(hashtagLine(next.hashtags));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 800);
  }
  const setLine = (i: number, text: string) => update({ ...draft, lines: lines.map((l, j) => (j === i ? text : l)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...lines];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    update({ ...draft, lines: next });
  };

  async function ask() {
    setAsking(true);
    setError(null);
    clearTimeout(timer.current);
    const res = await fetch(`/api/finals/${final.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, question }),
    });
    const body = (await res.json().catch(() => ({}))) as { final?: FinalView; error?: string };
    setAsking(false);
    if (res.ok && body.final) {
      onFinal(body.final);
      setQuestion("");
    } else {
      setError(body.error ?? "Couldn't get feedback");
    }
  }

  async function clear() {
    const res = await fetch(`/api/finals/${final.id}/feedback`, { method: "DELETE" });
    if (res.ok) onFinal(((await res.json()) as { final: FinalView }).final);
  }

  if (!captions) return null;
  const last: FeedbackTurn | undefined = final.feedback.at(-1);
  // Line numbers only mean something against the draft the model saw.
  const fresh = !!last && sameDraft(last.draft, draft);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line p-4 text-sm">
      <h2 className="font-medium">Your draft</h2>
      <p className="text-muted">Take lines and hashtags from the options above, or write your own.</p>

      <div className="flex flex-col gap-2">
        {captions.options.map((o, n) => (
          <details key={o.id} className="rounded-lg border border-line bg-surface p-2">
            <summary className="cursor-pointer">Option {n + 1} · {o.angle}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {o.text.split("\n").map((l, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">{l}</span>
                  <button type="button" className={btn} onClick={() => update({ ...draft, lines: [...lines, l] })}>
                    Add to draft
                  </button>
                </li>
              ))}
              {o.hashtags.length > 0 && (
                <li className="flex items-start gap-2 text-muted">
                  <span className="min-w-0 flex-1">{hashtagLine(o.hashtags)}</span>
                  <button type="button" className={btn} onClick={() => update({ ...draft, hashtags: o.hashtags })}>
                    Use these hashtags
                  </button>
                </li>
              )}
            </ul>
          </details>
        ))}
      </div>

      <ol className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="w-5 text-xs text-muted">{i + 1}</span>
            <input
              value={l}
              onChange={(e) => setLine(i, e.target.value)}
              aria-label={`Draft line ${i + 1}`}
              className="min-w-0 flex-1 rounded-lg border border-line bg-background p-2"
            />
            <button type="button" className={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button type="button" className={btn} disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </button>
            <button type="button" className={btn} onClick={() => update({ ...draft, lines: lines.filter((_, j) => j !== i) })} aria-label="Delete line">
              ✕
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className={`${btn} self-start`} onClick={() => update({ ...draft, lines: [...lines, ""] })}>
        + Add a line
      </button>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Hashtags (up to {MAX_HASHTAGS})</span>
        <input
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void save({ lines, hashtags: parseTags(e.target.value) }), 800);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded-lg border border-line bg-background p-2"
        />
      </label>
      <div className="flex flex-col gap-1">
        <div className="whitespace-pre-wrap rounded-lg border border-line bg-background p-3">{formatted.text || "…"}</div>
        <span className="text-xs text-muted">
          {formatted.charCount} / 2,200 characters · {draft.hashtags.length} / {MAX_HASHTAGS} hashtags
        </span>
        {formatted.warnings.map((w) => (
          <span key={w} className="text-xs text-bad">
            {w}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">Ask for feedback (optional question)</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. is line 1 hooky enough? too long?"
            className="rounded-lg border border-line bg-background p-2"
          />
        </label>
        <button
          type="button"
          disabled={asking || lines.every((l) => !l.trim())}
          onClick={() => void ask()}
          className="rounded-lg border border-line px-3 py-2 font-medium disabled:opacity-50"
        >
          {asking ? "Thinking…" : "Ask for feedback"}
        </button>
        <button
          type="button"
          disabled={lines.every((l) => !l.trim())}
          onClick={() => onUse(lines.join("\n"), draft.hashtags)}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Use this
        </button>
      </div>
      {error && <p className="text-bad">{error}</p>}

      {last && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{last.reply.score}/10</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs">{last.reply.verdict.replace("_", " ")}</span>
            <button type="button" onClick={() => void clear()} className="ml-auto text-xs text-muted underline">
              Clear thread
            </button>
          </div>
          <p>{last.reply.summary}</p>
          {last.reply.answer && (
            <p>
              <span className="font-medium">{last.question ? `“${last.question}” ` : ""}</span>
              {last.reply.answer}
            </p>
          )}
          <ul className="flex flex-col gap-0.5 text-xs">
            {Object.entries(last.reply.checks).map(([name, c]) => (
              <li key={name} className={c.ok ? "text-muted" : "text-bad"}>
                {c.ok ? "✓" : "✗"} {name}: {c.note}
              </li>
            ))}
          </ul>
          {last.reply.suggestions.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line bg-background p-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">
                  {s.kind.replace("_", " ")}
                  {s.kind !== "replace_hashtags" && s.line > 0 && ` · line ${s.line}`} · {s.why}
                </div>
                {s.text && <div>{s.kind === "replace_hashtags" ? hashtagLine(parseTags(s.text)) : s.text}</div>}
              </div>
              <button type="button" className={btn} disabled={!fresh} onClick={() => update(applySuggestion(draft, s))}>
                Apply
              </button>
            </div>
          ))}
          {!fresh && last.reply.suggestions.length > 0 && (
            <p className="text-xs text-muted">The draft changed since this feedback. Ask again to get suggestions that fit.</p>
          )}
          {final.feedback.length > 1 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Earlier ({final.feedback.length - 1})</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {final.feedback.slice(0, -1).map((t, i) => (
                  <li key={i}>
                    {t.question || "(no question)"} → {t.reply.score}/10: {t.reply.summary}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
