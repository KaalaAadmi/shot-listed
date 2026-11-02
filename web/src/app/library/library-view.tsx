"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetView } from "@/lib/types";
import { Uploader } from "./uploader";

type Usage = { bytes: number; photos: number; videos: number; freeTierBytes: number };
type Page = { items: AssetView[]; nextBefore: string | null; usage: Usage };
type Filter = "all" | "photo" | "video";

async function fetchPage(filter: Filter, before?: string): Promise<Page | Error> {
  try {
    const qs = new URLSearchParams({ limit: "48" });
    if (filter !== "all") qs.set("kind", filter);
    if (before) qs.set("before", before);
    const res = await fetch(`/api/media/assets?${qs}`);
    const body = await res.json();
    if (!res.ok) return new Error(body.error ?? "Could not load the library");
    return body as Page;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function gb(n: number) {
  return (n / 1024 ** 3).toFixed(n < 1024 ** 3 ? 2 : 1);
}

export function LibraryView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AssetView[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AssetView | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const apply = useCallback((result: Page | Error, before?: string) => {
    if (result instanceof Error) {
      setError(result.message);
    } else {
      setItems((prev) => (before ? [...prev, ...result.items] : result.items));
      setNext(result.nextBefore);
      setUsage(result.usage);
      setError(null);
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    async (before?: string) => apply(await fetchPage(filter, before), before),
    [filter, apply],
  );

  useEffect(() => {
    let current = true;
    void fetchPage(filter).then((result) => current && apply(result));
    return () => {
      current = false;
    };
  }, [filter, apply]);

  // Many uploads finish close together; refresh the grid once they settle.
  const onUploaded = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void load(), 1500);
  }, [load]);

  async function remove(asset: AssetView) {
    if (!confirm(`Delete ${asset.filename} from Reel Studio? It stays on your phone.`)) return;
    const res = await fetch(`/api/media/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((a) => a.id !== asset.id));
      setOpen(null);
      void load();
    }
  }

  const pct = usage ? Math.min(100, (usage.bytes / usage.freeTierBytes) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="text-sm text-muted">
          Photos and clips the planner can pick from. Files go straight from your phone to your R2 bucket.
        </p>
      </div>

      <Uploader onUploaded={onUploaded} />

      {usage && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between text-muted">
            <span>
              {usage.photos} photos · {usage.videos} videos
            </span>
            <span>
              {gb(usage.bytes)} GB of {gb(usage.freeTierBytes)} GB free tier
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className={`h-full ${pct > 85 ? "bg-bad" : "bg-accent"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex gap-2 text-sm" role="tablist">
        {(["all", "photo", "video"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => {
              if (f === filter) return;
              setLoading(true);
              setFilter(f);
            }}
            className={`rounded-full border px-3 py-1 ${
              filter === f ? "border-accent bg-accent-soft text-foreground" : "border-line text-muted"
            }`}
          >
            {f === "all" ? "All" : f === "photo" ? "Photos" : "Videos"}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg border border-bad/40 p-3 text-sm text-bad">{error}</p>}

      {!loading && items.length === 0 && !error && (
        <p className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted">
          Nothing here yet. Add a few gym, kitchen and city clips to start.
        </p>
      )}

      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {items.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setOpen(a)}
              className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-line"
              aria-label={a.filename}
            >
              {a.url &&
                (a.kind === "video" ? (
                  <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, no optimiser
                  <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ))}
              {a.kind === "video" && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Video</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {next && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(next);
          }}
          className="self-center rounded-lg border border-line px-4 py-2 text-sm"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.filename}
        >
          <div className="flex max-h-full w-full max-w-md flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {open.url &&
              (open.kind === "video" ? (
                <video src={open.url} controls playsInline autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.url} alt={open.filename} className="max-h-[70vh] w-full rounded-lg object-contain" />
              ))}
            <div className="flex items-center gap-3 text-sm text-white">
              <span className="min-w-0 flex-1 truncate">{open.filename}</span>
              <a href={`/api/media/assets/${open.id}/download`} className="underline">
                Download
              </a>
              <button type="button" onClick={() => void remove(open)} className="text-[#ff8787]">
                Delete
              </button>
              <button type="button" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
