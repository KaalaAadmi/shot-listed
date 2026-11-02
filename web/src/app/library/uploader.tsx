"use client";

import { useEffect, useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/policy";
import { uploadFile } from "@/lib/upload-client";

type Item = {
  key: string;
  file: File;
  progress: number;
  /** Hashing progress, before any bytes are sent; this is how duplicates are caught early. */
  checking: number;
  state: "queued" | "checking" | "uploading" | "done" | "duplicate" | "failed" | "cancelled";
  error?: string;
};

const FILE_CONCURRENCY = 3;

function formatBytes(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function Uploader({ onUploaded }: { onUploaded: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(0);
  // Guards against starting the same file twice when effects re-run.
  const started = useRef(new Set<string>());

  const busy = items.some((i) => i.state === "queued" || i.state === "checking" || i.state === "uploading");

  // Keep the phone awake and warn before leaving while uploads are running.
  useEffect(() => {
    if (!busy) return;
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      lock?.release().catch(() => undefined);
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Start queued items whenever a slot is free.
  useEffect(() => {
    const queued = items.filter((i) => i.state === "queued" && !started.current.has(i.key));
    for (const item of queued) {
      if (running.current >= FILE_CONCURRENCY) break;
      started.current.add(item.key);
      running.current += 1;
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      update(item.key, { state: "checking", checking: 0 });
      uploadFile(item.file, (p) => update(item.key, { state: "uploading", progress: p }), controller.signal, {
        onChecking: (c) => update(item.key, { checking: c }),
      })
        .then(({ outcome }) => {
          update(item.key, { state: outcome === "duplicate" ? "duplicate" : "done", progress: 1 });
          onUploaded();
        })
        .catch((err: unknown) => {
          const cancelled = err instanceof DOMException && err.name === "AbortError";
          update(item.key, {
            state: cancelled ? "cancelled" : "failed",
            error: cancelled ? undefined : err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          running.current -= 1;
          controllers.current.delete(item.key);
          setItems((prev) => [...prev]); // nudge the effect to pick up the next queued file
        });
    }
  }, [items, onUploaded]);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const added = Array.from(files).map((file, n) => ({
      key: `${Date.now()}-${n}-${file.name}`,
      file,
      progress: 0,
      checking: 0,
      state: "queued" as const,
    }));
    setItems((prev) => [...added, ...prev.filter((i) => i.state !== "done" && i.state !== "duplicate")]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function retry(key: string) {
    started.current.delete(key);
    // The upload is kept on the server, so this resumes from the parts already sent.
    update(key, { state: "queued", progress: 0, error: undefined });
  }

  const totalBytes = items.reduce((s, i) => s + i.file.size, 0);
  const doneBytes = items.reduce((s, i) => s + i.file.size * i.progress, 0);

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white active:opacity-80"
        >
          Add photos and videos
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        {items.length > 0 && (
          <p className="text-sm text-muted">
            {busy ? "Uploading" : "Done"} · {formatBytes(doneBytes)} of {formatBytes(totalBytes)}
            {busy && " · keep this tab open"}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-line text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{item.file.name}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full ${item.state === "failed" ? "bg-bad" : "bg-accent"}`}
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>
                {item.error && <p className="mt-1 text-xs text-bad">{item.error}</p>}
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-muted">
                {item.state === "checking" && `Checking ${Math.round(item.checking * 100)}%`}
                {item.state === "uploading" && `${Math.round(item.progress * 100)}%`}
                {item.state === "queued" && "Waiting"}
                {item.state === "done" && <span className="text-ok">Uploaded</span>}
                {item.state === "duplicate" && "Already in library"}
                {item.state === "cancelled" && "Cancelled"}
                {item.state === "failed" && (
                  <button type="button" onClick={() => retry(item.key)} className="font-medium text-accent">
                    Retry
                  </button>
                )}
              </span>
              {(item.state === "checking" || item.state === "uploading" || item.state === "queued") && (
                <button
                  type="button"
                  aria-label={`Cancel ${item.file.name}`}
                  onClick={() =>
                    item.state === "queued"
                      ? update(item.key, { state: "cancelled" })
                      : controllers.current.get(item.key)?.abort()
                  }
                  className="text-muted hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
