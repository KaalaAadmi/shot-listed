"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTINGS } from "@/lib/library-index";
import type { AssetView } from "@/lib/types";
import { Uploader } from "./uploader";

type Usage = { bytes: number; photos: number; videos: number; freeTierBytes: number };
type Page = { items: AssetView[]; nextBefore: string | null; usage: Usage; duplicates: number };
type Filter = "all" | "photo" | "video";

type Query = { filter: Filter; setting: string; q: string };

async function fetchPage({ filter, setting, q }: Query, before?: string): Promise<Page | Error> {
  try {
    const qs = new URLSearchParams({ limit: "48" });
    if (filter !== "all") qs.set("kind", filter);
    if (setting) qs.set("setting", setting);
    if (q) qs.set("q", q);
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
  const [setting, setSetting] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [duplicates, setDuplicates] = useState(0);
  const [items, setItems] = useState<AssetView[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AssetView | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The grid shows thumbnails; the viewer needs the file itself.
  function show(a: AssetView | null) {
    setOpen(a);
    setFull(null);
    if (a) {
      void fetch(`/api/media/assets/${a.id}`)
        .then((r) => r.json())
        .then((b) => setFull(b.asset?.url ?? null))
        .catch(() => undefined);
    }
  }

  async function patch(a: AssetView, body: object) {
    const res = await fetch(`/api/media/assets/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "Could not save that");
    const next = { ...(json.asset as AssetView), url: a.url, thumb: a.thumb };
    setItems((prev) => prev.map((x) => (x.id === a.id ? next : x)));
    setOpen(next);
  }

  const apply = useCallback((result: Page | Error, before?: string) => {
    if (result instanceof Error) {
      setError(result.message);
    } else {
      setItems((prev) => (before ? [...prev, ...result.items] : result.items));
      setNext(result.nextBefore);
      setUsage(result.usage);
      setDuplicates(result.duplicates);
      setError(null);
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    async (before?: string) => apply(await fetchPage({ filter, setting, q }, before), before),
    [filter, setting, q, apply],
  );

  useEffect(() => {
    let current = true;
    void fetchPage({ filter, setting, q }).then((result) => current && apply(result));
    return () => {
      current = false;
    };
  }, [filter, setting, q, apply]);

  // Many uploads finish close together; refresh the grid once they settle.
  const onUploaded = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void load(), 1500);
  }, [load]);

  async function remove(asset: AssetView) {
    if (!confirm(`Delete ${asset.filename} from ShotListed? It stays on your phone.`)) return;
    const res = await fetch(`/api/media/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((a) => a.id !== asset.id));
      show(null);
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

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setLoading(true);
          setQ(search.trim());
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search in plain words: gym mirror selfie"
          className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setLoading(true);
              setQ("");
            }}
            className="rounded-lg border border-line px-3 text-sm text-muted"
          >
            Clear
          </button>
        )}
      </form>

      {duplicates > 0 && (
        <Link href="/library/duplicates" className="text-sm underline">
          Possible duplicates ({duplicates})
        </Link>
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

      <div className="flex flex-wrap gap-1.5 text-xs">
        {SETTINGS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={setting === t}
            onClick={() => {
              setLoading(true);
              setSetting(setting === t ? "" : t);
            }}
            className={`rounded-full border px-2.5 py-0.5 ${setting === t ? "border-accent bg-accent-soft" : "border-line text-muted"}`}
          >
            {t.replace("_", " / ")}
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
              onClick={() => show(a)}
              className={`relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-line ${a.excluded ? "opacity-40" : ""}`}
              aria-label={a.tags?.caption ?? a.filename}
            >
              {a.url &&
                (a.kind === "video" && !a.thumb ? (
                  <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, no optimiser
                  <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ))}
              {a.kind === "video" && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Video</span>
              )}
              {a.excluded && (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Left out</span>
              )}
              {a.indexStatus === "pending" || a.indexStatus === "processing" ? (
                <span className="absolute left-1 bottom-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Tagging…</span>
              ) : null}
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
          onClick={() => show(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.filename}
        >
          <div className="flex max-h-full w-full max-w-md flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {(full ?? open.url) &&
              (open.kind === "video" ? (
                full ? (
                  <video src={full} controls playsInline autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={open.url!} alt="" className="max-h-[70vh] w-full rounded-lg object-contain" />
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={full ?? open.url!} alt={open.filename} className="max-h-[70vh] w-full rounded-lg object-contain" />
              ))}
            <TagEditor key={open.id + open.indexStatus} asset={open} onSave={(body) => patch(open, body)} />
            <div className="flex items-center gap-3 text-sm text-white">
              <span className="min-w-0 flex-1 truncate">{open.filename}</span>
              <a href={`/api/media/assets/${open.id}/download`} className="underline">
                Download
              </a>
              <button type="button" onClick={() => void remove(open)} className="text-[#ff8787]">
                Delete
              </button>
              <button type="button" onClick={() => show(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the model saw, editable, plus the exclude toggle. Saving re-embeds so search follows the correction. */
function TagEditor({ asset, onSave }: { asset: AssetView; onSave: (body: object) => Promise<void> }) {
  const t = asset.tags;
  const [caption, setCaption] = useState(t?.caption ?? "");
  const [busy, setBusy] = useState(false);
  const run = async (body: object) => {
    setBusy(true);
    await onSave(body);
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white/10 p-3 text-sm text-white">
      {t ? (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            className="rounded bg-black/40 p-2 text-white"
            aria-label="What this shows"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <select
              value={t.setting}
              onChange={(e) => void run({ tags: { setting: e.target.value } })}
              className="rounded bg-black/40 px-2 py-1"
              aria-label="Setting"
              disabled={busy}
            >
              {SETTINGS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {[t.shotType, t.mood, ...t.objects.slice(0, 4)].filter(Boolean).map((c) => (
              <span key={c} className="rounded-full bg-black/40 px-2 py-0.5">
                {c}
              </span>
            ))}
            {caption.trim() && caption.trim() !== t.caption && (
              <button type="button" disabled={busy} onClick={() => void run({ tags: { caption: caption.trim() } })} className="ml-auto underline">
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </div>
          {t.unusable && <p className="text-xs text-[#ffd8a8]">Left out automatically: {t.unusableReason || "not usable"}.</p>}
        </>
      ) : (
        <p className="text-xs">
          {asset.indexStatus === "failed" ? "Tagging failed. It will be retried." : "Not tagged yet. The pipeline host does this within a couple of minutes."}
        </p>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={asset.excluded} disabled={busy} onChange={(e) => void run({ excluded: e.target.checked })} />
        Never use in plans
      </label>
    </div>
  );
}
