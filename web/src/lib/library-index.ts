// Pure rules for library indexing: tag cleanup, embedding text and recognising the same
// shot saved twice (docs/TRD.md §4.1). No server imports, so tests and the UI can use it.
import type { DuplicateDoc, LibraryItemDoc, Tags } from "./types.ts";

// ---------- Tags and embeddings ----------

export const SETTINGS = ["home", "gym", "street", "office", "cafe_restaurant", "shop", "nature", "transport", "event", "screen", "other"] as const;
export const SHOT_TYPES = ["selfie", "mirror_selfie", "pov", "wide", "medium", "close_up", "over_shoulder", "screen_recording", "text_slide", "b_roll", "other"] as const;

/** The host embeds with the same model and size; change both together. */
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768;

/** Code checks from prompts/library-tagger.md: trim text, cap the lists. */
export function cleanTags(t: Tags): Tags {
  const list = (xs: string[], max: number) => xs.map((x) => x.trim()).filter(Boolean).slice(0, max);
  return {
    ...t,
    caption: t.caption.trim(),
    action: t.action.trim(),
    mood: t.mood.trim(),
    visibleText: t.visibleText.trim(),
    objects: list(t.objects, 8),
    useFor: list(t.useFor, 4),
    quality: { ...t.quality, note: t.quality.note.trim() },
    unusableReason: t.unusable ? t.unusableReason.trim() : "",
  };
}

/** What gets embedded: the caption, then action, objects and uses. Re-embed whenever a tag is corrected. */
export function embeddingText(t: Tags): string {
  return [t.caption, [t.action, ...t.objects, ...t.useFor].filter(Boolean).join(", ")].filter(Boolean).join(". ");
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- Same shot ----------

export type Facts = {
  id: string;
  kind: "photo" | "video";
  /** Capture time in whole seconds, plus the fraction when the file has one. */
  atS: number;
  subsec?: number;
  width: number;
  height: number;
  durationS?: number;
  phash: string[];
  contentHash: string | null;
  size: number;
  contentType: string;
  codec?: string;
};

export type Orientation = "vertical" | "horizontal" | "square";

export const orientationOf = (w: number, h: number): Orientation => (w === h ? "square" : w > h ? "horizontal" : "vertical");

/** The facts matching needs, or null while the item isn't indexed. `atS` is NaN without capture data. */
export function factsOf(d: LibraryItemDoc): Facts | null {
  if (!d.phash?.length || !d.width || !d.height) return null;
  return {
    id: d._id,
    kind: d.kind,
    atS: d.capture ? Math.floor(d.capture.at.getTime() / 1000) : NaN,
    subsec: d.capture?.subsec,
    width: d.width,
    height: d.height,
    durationS: d.durationS,
    phash: d.phash,
    contentHash: d.contentHash,
    size: d.size,
    contentType: d.contentType,
    codec: d.codec,
  };
}

/** Number of differing bits between two 64-bit hashes written in hex. */
export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/** The largest distance between matching frames; null when the hash counts differ. */
function distance(a: string[], b: string[]): number | null {
  return a.length && a.length === b.length ? Math.max(...a.map((h, i) => hamming(h, b[i]))) : null;
}

export type Match = Pick<DuplicateDoc, "verdict" | "evidence" | "betterFile">;

/** `older` and `newer` by upload order. Null means different shots. */
export function compareShots(older: Facts, newer: Facts): Match | null {
  if (older.kind !== newer.kind) return null;
  if (Number.isNaN(older.atS) || Number.isNaN(newer.atS)) return null; // no capture time, no match
  if (orientationOf(older.width, older.height) !== orientationOf(newer.width, newer.height)) return null;

  const video = older.kind === "video";
  const secondsApart = Math.abs(older.atS + (older.subsec ?? 0) - (newer.atS + (newer.subsec ?? 0)));
  if (secondsApart > 2) return null;
  const durationDiff = video ? Math.abs((older.durationS ?? 0) - (newer.durationS ?? 0)) : null;
  if (durationDiff !== null && durationDiff > 0.5) return null;
  const d = distance(older.phash, newer.phash);
  if (d === null || d > 12) return null;

  const bothSubsec = older.subsec !== undefined && newer.subsec !== undefined;
  // Burst shots share a second and look alike, so a missing fraction needs a tighter hash match.
  const subsecMatch = bothSubsec ? Math.abs(older.subsec! - newer.subsec!) <= 0.02 : null;
  const sameSecond = older.atS === newer.atS;
  const limit = !bothSubsec ? 2 : video ? 6 : 4;
  const same = sameSecond && subsecMatch !== false && d <= limit && (!video || durationDiff! <= 0.1);

  return {
    verdict: same ? "same" : "possible",
    evidence: {
      secondsApart: Math.round(secondsApart * 1000) / 1000,
      subsecMatch,
      hashDistance: d,
      durationDiff,
      sameBytes: !!older.contentHash && older.contentHash === newer.contentHash,
    },
    betterFile: betterFile(older, newer),
  };
}

const isOriginalFormat = (f: Facts) => /hei[cf]/i.test(f.contentType) || /hevc|h265/i.test(f.codec ?? "");

/** More pixels; then (video) higher bitrate; then HEIC/HEVC over a converted copy; a tie keeps the older. */
export function betterFile(older: Facts, newer: Facts): "keep" | "other" {
  const pixels = older.width * older.height - newer.width * newer.height;
  if (pixels) return pixels > 0 ? "keep" : "other";
  if (older.kind === "video") {
    const rate = (f: Facts) => (f.durationS ? f.size / f.durationS : 0);
    if (rate(older) !== rate(newer)) return rate(older) > rate(newer) ? "keep" : "other";
  }
  if (isOriginalFormat(older) !== isOriginalFormat(newer)) return isOriginalFormat(older) ? "keep" : "other";
  return "keep";
}

/** A library video that is probably a final cut: same bytes, or same length and look. */
export function matchesFinalCut(video: Facts, final: Facts): boolean {
  if (video.contentHash && video.contentHash === final.contentHash) return true;
  if (video.kind !== "video" || final.kind !== "video") return false;
  const d = distance(video.phash, final.phash);
  return Math.abs((video.durationS ?? 0) - (final.durationS ?? 0)) <= 0.5 && d !== null && d <= 6;
}
