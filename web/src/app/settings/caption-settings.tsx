"use client";

import { useEffect, useState } from "react";
import type { HashtagPlacement } from "@/lib/captions/instagram-format";

type CaptionSettingsState = {
  captionSystemPrompt: string;
  captionContentHistory: string;
  systemPromptIsDefault: boolean;
  contentHistoryIsDefault: boolean;
  hashtagPlacement: HashtagPlacement;
  blankLineBeforeHashtags: boolean;
};

type Patch = Partial<{
  captionSystemPrompt: string | null;
  captionContentHistory: string | null;
  hashtagPlacement: HashtagPlacement;
  blankLineBeforeHashtags: boolean;
}>;

function VoiceField({
  title,
  help,
  saved,
  isDefault,
  rows,
  onSave,
}: {
  title: string;
  help: string;
  saved: string;
  isDefault: boolean;
  rows: number;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changed = value !== saved;

  async function save(v: string | null) {
    setBusy(true);
    await onSave(v);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{title}</span>
        {isDefault && <span className="rounded-full border border-line px-2 text-xs text-muted">Default</span>}
      </div>
      <span className="text-muted">{help}</span>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!changed || busy}
          onClick={() => void save(value)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
        {changed && (
          <button type="button" onClick={() => setValue(saved)} className="rounded-lg border border-line px-3 py-2 text-sm">
            Discard changes
          </button>
        )}
        {!isDefault && (
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm(`Restore the default ${title.toLowerCase()}? Your edits will be lost.`) && void save(null)}
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
          >
            Restore default
          </button>
        )}
      </div>
    </div>
  );
}

export function CaptionSettings() {
  const [state, setState] = useState<CaptionSettingsState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: CaptionSettingsState | null) => s && setState(s));
  }, []);

  async function save(patch: Patch, label: string) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setState((await res.json()) as CaptionSettingsState);
      setMessage(`${label} saved.`);
    } else {
      setMessage("Couldn't save. Try again.");
    }
  }

  if (!state) return null;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Caption voice</h2>
        <p className="text-sm text-muted">
          Every caption round uses these two, exactly as written here. The app adds a short note after them so the
          answer comes back as cards you can pick and copy, instead of the Section 8 text layout.
        </p>
      </div>

      <VoiceField
        // Remount after a save so the box shows what the server now holds.
        key={`prompt-${state.captionSystemPrompt.length}-${state.systemPromptIsDefault}`}
        title="Social Media Manager prompt"
        help="Your role, account, caption rules and benchmarks (v3.0 to start)."
        saved={state.captionSystemPrompt}
        isDefault={state.systemPromptIsDefault}
        rows={14}
        onSave={(v) => save({ captionSystemPrompt: v }, "Prompt")}
      />

      <VoiceField
        key={`history-${state.captionContentHistory.length}-${state.contentHistoryIsDefault}`}
        title="Content history"
        help="Your reel performance history. Add each new reel's numbers here so feedback compares against them."
        saved={state.captionContentHistory}
        isDefault={state.contentHistoryIsDefault}
        rows={10}
        onSave={(v) => save({ captionContentHistory: v }, "Content history")}
      />

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Where hashtags go</legend>
        {(
          [
            ["caption", "At the end of the caption"],
            ["first-comment", "In the first comment"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="hashtags"
              checked={state.hashtagPlacement === value}
              onChange={() => void save({ hashtagPlacement: value }, "Hashtag placement")}
              className="accent-[var(--accent)]"
            />
            {label}
          </label>
        ))}
        <label className="mt-1 flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.blankLineBeforeHashtags}
            disabled={state.hashtagPlacement !== "caption"}
            onChange={(e) => void save({ blankLineBeforeHashtags: e.target.checked }, "Spacing")}
            className="accent-[var(--accent)]"
          />
          Leave a blank line before the hashtags
        </label>
        <span className="text-xs text-muted">
          Off matches your caption structure (hashtags on line 5). Instagram allows up to 5 hashtags per post.
        </span>
      </fieldset>

      {message && <p className="text-sm text-muted">{message}</p>}
    </section>
  );
}
