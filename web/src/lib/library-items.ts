import "server-only";
import { after } from "next/server";
import { HttpError } from "./auth";
import { collections } from "./db";
import { embed } from "./embed";
import { cleanTags, cosine, embeddingText } from "./library-index.ts";
import { enqueue } from "./jobs";
import { COLLECTION, storage } from "./storage/connector.ts";
import type { StorageAsset } from "./storage/types.ts";
import type { AssetOrigin, AssetPurpose, AssetView, LibraryItemDoc, Tags } from "./types";

// library_items: one document per storage asset, created when an upload finishes (or by the
// backfill) and filled in by the pipeline host's `index-asset` job. Listing, search and
// corrections work from here; the file bytes stay in storage.

const PURPOSE_OF: Record<string, AssetPurpose> = { [COLLECTION.library]: "library", [COLLECTION["final-cut"]]: "final-cut" };

function docFrom(a: StorageAsset): LibraryItemDoc | null {
  const purpose = PURPOSE_OF[a.collection];
  if (!purpose || a.kind === "file" || a.status !== "uploaded") return null;
  const now = new Date();
  return {
    _id: a.id,
    purpose,
    origin: (a.metadata.origin as AssetOrigin | undefined) ?? "phone-upload",
    kind: a.kind,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    takenAt: a.takenAt ? new Date(a.takenAt) : null,
    contentHash: a.contentHash,
    ...(a.externalId ? { externalId: a.externalId } : {}),
    variants: { proxy: false, thumb: false },
    index: { status: "pending", at: now },
    excluded: false,
    createdAt: new Date(a.createdAt),
    updatedAt: now,
  };
}

/** Adds the item (if new) and asks the pipeline host to index it. Safe to call twice. */
export async function registerAsset(a: StorageAsset): Promise<void> {
  const doc = docFrom(a);
  if (!doc) return;
  const { items } = await collections();
  const res = await items.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  if (res.upsertedCount) await enqueue("index-asset", { itemId: doc._id });
}

/** Registers every uploaded library item and final cut that has no record yet. */
export async function backfill(): Promise<number> {
  const { items } = await collections();
  let added = 0;
  for (const collection of Object.values(COLLECTION)) {
    let before: string | undefined;
    do {
      const page = await storage().listAssets({ collection, limit: 100, before });
      const known = new Set(
        (await items.find({ _id: { $in: page.items.map((a) => a.id) } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
      );
      for (const a of page.items.filter((x) => !known.has(x.id))) {
        await registerAsset(a);
        added++;
      }
      before = page.next ?? undefined;
    } while (before);
  }
  return added;
}

let lastSync = 0;

/**
 * Gives files uploaded before indexing existed their library records. The first time it runs
 * inline so the Library isn't empty; after that it runs in the background, at most hourly.
 */
export async function syncIfNeeded(): Promise<void> {
  const { items } = await collections();
  if ((await items.estimatedDocumentCount()) === 0) {
    lastSync = Date.now();
    await backfill();
  } else if (Date.now() - lastSync > 3600_000) {
    lastSync = Date.now();
    after(backfill);
  }
}

/** For the pipeline host's `index-asset` job. */
export async function hostItem(id: string) {
  const { items } = await collections();
  const d = await items.findOne({ _id: id }, { projection: { embedding: 0 } });
  if (!d) throw new HttpError(404, "Not found");
  return {
    id: d._id,
    purpose: d.purpose,
    kind: d.kind,
    filename: d.filename,
    contentType: d.contentType,
    contentHash: d.contentHash,
    takenAt: d.takenAt?.toISOString() ?? null,
  };
}

export async function removeItem(id: string): Promise<void> {
  const { items, duplicates } = await collections();
  await items.deleteOne({ _id: id });
  // Anything hidden behind it comes back; pairs involving it are moot.
  await items.updateMany({ hiddenAsDuplicateOf: id }, { $unset: { hiddenAsDuplicateOf: "" } });
  await duplicates.deleteMany({ $or: [{ keepId: id }, { otherId: id }] });
}

// ---------- Reading ----------

export function toView(d: LibraryItemDoc, url: string | null): AssetView {
  return {
    id: d._id,
    origin: d.origin,
    filename: d.filename,
    contentType: d.contentType,
    kind: d.kind,
    size: d.size,
    status: "uploaded",
    takenAt: d.takenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    url,
    thumb: d.variants.thumb,
    tags: d.tags ?? null,
    excluded: d.excluded,
    indexStatus: d.index.status,
  };
}

/** Signed links in one storage call: thumbnails where they exist, the original until then. */
export async function viewsOf(docs: LibraryItemDoc[]): Promise<AssetView[]> {
  if (!docs.length) return [];
  const { urls } = await storage().getUrls(docs.map((d) => ({ id: d._id, variant: d.variants.thumb ? "thumb" : undefined })));
  const byId = new Map(urls.map((u) => [u.id, u.url]));
  return docs.map((d) => toView(d, byId.get(d._id) ?? null));
}

const VISIBLE = { purpose: "library", hiddenAsDuplicateOf: { $exists: false } } as const;

export type ListOptions = { kind?: "photo" | "video"; setting?: string; before?: string; limit: number };

/** Newest first. `before` is the cursor from the previous page. */
export async function listItems(o: ListOptions) {
  const { items } = await collections();
  const filter: Record<string, unknown> = { ...VISIBLE };
  if (o.kind) filter.kind = o.kind;
  if (o.setting) filter["tags.setting"] = o.setting;
  if (o.before) {
    const [at, id] = o.before.split("|");
    const t = new Date(at);
    if (Number.isNaN(t.getTime()) || !id) throw new HttpError(400, "Bad cursor");
    filter.$or = [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: id } }];
  }
  const docs = await items
    .find(filter, { projection: { embedding: 0 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(o.limit + 1)
    .toArray();
  const page = docs.slice(0, o.limit);
  const last = page.at(-1);
  return {
    items: await viewsOf(page),
    nextBefore: docs.length > o.limit && last ? `${last.createdAt.toISOString()}|${last._id}` : null,
  };
}

/** Plain-words search: the closest items by meaning. Brute force, fine for a few thousand items. */
export async function searchItems(q: string, limit: number) {
  const { items } = await collections();
  const query = await embed(q);
  // ponytail: ships every embedding per search (~6 KB each); move to Atlas Vector Search past ~10k items.
  const all = await items.find({ ...VISIBLE, embedding: { $exists: true } }, { projection: { embedding: 1 } }).toArray();
  const top = all
    .map((d) => ({ id: d._id, score: cosine(query, d.embedding!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const docs = await items.find({ _id: { $in: top.map((t) => t.id) } }, { projection: { embedding: 0 } }).toArray();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return { items: await viewsOf(top.flatMap((t) => byId.get(t.id) ?? [])), nextBefore: null };
}

/**
 * For each text, how many visible, non-excluded library items look like a match. A cheap estimate for
 * the viability score; the plan's clip grader does the real judging.
 */
export async function likelyClips(texts: string[]): Promise<number[]> {
  const { items } = await collections();
  const [queries, all] = await Promise.all([
    Promise.all(texts.map((t) => embed(t))),
    items.find({ ...VISIBLE, excluded: false, embedding: { $exists: true } }, { projection: { embedding: 1 } }).toArray(),
  ]);
  // ponytail: 0.7 is a guess for gemini-embedding-001; tune it against real library matches.
  return queries.map((q) => Math.min(5, all.filter((d) => cosine(q, d.embedding!) >= 0.7).length));
}

/** The `limit` visible, non-excluded items whose meaning is closest to `text`, best first. */
export async function nearest(text: string, limit: number): Promise<LibraryItemDoc[]> {
  const { items } = await collections();
  const [query, all] = await Promise.all([
    embed(text),
    items.find({ ...VISIBLE, excluded: false, embedding: { $exists: true } }, { projection: { embedding: 1 } }).toArray(),
  ]);
  const top = all
    .map((d) => ({ id: d._id, score: cosine(query, d.embedding!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const docs = await items.find({ _id: { $in: top.map((t) => t.id) } }, { projection: { embedding: 0 } }).toArray();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return top.flatMap((t) => byId.get(t.id) ?? []);
}

// ---------- Corrections ----------

export type ItemPatch = { excluded?: boolean; tags?: Partial<Pick<Tags, "caption" | "setting" | "shotType" | "action" | "mood">> };

export async function patchItem(id: string, patch: ItemPatch): Promise<AssetView> {
  const { items } = await collections();
  const doc = await items.findOne({ _id: id }, { projection: { embedding: 0 } });
  if (!doc) throw new HttpError(404, "Not found");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.excluded !== undefined) set.excluded = patch.excluded;
  if (patch.tags) {
    if (!doc.tags) throw new HttpError(409, "Not tagged yet");
    const tags = cleanTags({ ...doc.tags, ...patch.tags });
    set.tags = tags;
    // The embedding follows the tags, so a corrected caption changes what search finds.
    set.embedding = await embed(embeddingText(tags));
    doc.tags = tags;
  }
  await items.updateOne({ _id: id }, { $set: set });
  const [view] = await viewsOf([{ ...doc, ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}) }]);
  return view;
}
