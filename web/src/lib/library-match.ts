import "server-only";
import { after } from "next/server";
import { HttpError } from "./auth";
import { collections } from "./db";
import { enqueue } from "./jobs";
import { viewsOf } from "./library-items";
import { repoint } from "./plan-rules.ts";
import { cleanTags, compareShots, factsOf, matchesFinalCut, type Match } from "./library-index.ts";
import { StorageError } from "./storage/client.ts";
import { storage } from "./storage/connector.ts";
import type { DuplicateDoc, LibraryItemDoc, Tags } from "./types";

const UNDO_MS = 7 * 86400_000;
const WINDOW_MS = 3000; // candidates: capture times within 2 s, with a second of slack

/** What the pipeline host measured and saw; see pipeline/ and docs/TRD.md §4. */
export type IndexResult = {
  durationS?: number;
  width: number;
  height: number;
  codec?: string;
  contentHash: string;
  capture?: { at: string; subsec?: number; tz?: string; camera?: string };
  phash: string[];
  variants: { proxy: boolean; thumb: boolean };
  /** Absent for final cuts, which get the light version. */
  tags?: Tags;
  embedding?: number[];
};

/** Saves an index result, fixes storage's hash if it was wrong, then looks for copies of the same shot. */
export async function recordIndexed(id: string, r: IndexResult): Promise<void> {
  const { items } = await collections();
  const doc = await items.findOne({ _id: id }, { projection: { embedding: 0 } });
  if (!doc) throw new HttpError(404, "Not found");
  const tags = r.tags && cleanTags(r.tags);
  const now = new Date();

  if (doc.contentHash !== r.contentHash) {
    // The uploader's claimed hash was wrong. Storage refuses a hash another asset has; then the two are copies.
    await storage()
      .updateAsset(id, { contentHash: r.contentHash })
      .catch((err: unknown) => {
        if (!(err instanceof StorageError && err.status === 409)) throw err;
      });
  }
  await items.updateOne(
    { _id: id },
    {
      $set: {
        durationS: r.durationS,
        width: r.width,
        height: r.height,
        codec: r.codec,
        contentHash: r.contentHash,
        ...(r.capture ? { capture: { ...r.capture, at: new Date(r.capture.at) } } : {}),
        phash: r.phash,
        variants: r.variants,
        index: { status: "indexed", at: now },
        ...(tags ? { tags, embedding: r.embedding, ...(tags.unusable ? { excluded: true } : {}) } : {}),
        updatedAt: now,
      },
    },
  );
  await findMatches(id);
}

export async function markIndexFailed(id: string, error: string): Promise<void> {
  const { items } = await collections();
  await items.updateOne({ _id: id }, { $set: { "index.status": "failed", "index.error": error.slice(0, 500), "index.at": new Date() } });
}

function pairOf(a: LibraryItemDoc, b: LibraryItemDoc): [older: LibraryItemDoc, newer: LibraryItemDoc] {
  return a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
}

/** Compares one freshly indexed item with its neighbours in time and records what it finds. */
async function findMatches(id: string): Promise<void> {
  const { items, duplicates } = await collections();
  const me = await items.findOne({ _id: id }, { projection: { embedding: 0 } });
  const mine = me && factsOf(me);
  if (!me || !mine || !me.capture) return;

  const near = await items
    .find(
      { _id: { $ne: id }, kind: me.kind, "index.status": "indexed", "capture.at": { $gte: new Date(me.capture.at.getTime() - WINDOW_MS), $lte: new Date(me.capture.at.getTime() + WINDOW_MS) } },
      { projection: { embedding: 0 } },
    )
    .toArray();

  for (const other of near.filter((o) => o.purpose === me.purpose)) {
    const [older, newer] = pairOf(me, other);
    const olderFacts = factsOf(older);
    const newerFacts = factsOf(newer);
    const m = olderFacts && newerFacts && compareShots(olderFacts, newerFacts);
    if (m) await recordPair(older, newer, m);
  }

  // A library video that looks like a final cut is held back until you decide.
  if (me.kind === "video") {
    const finals = near.filter((o) => o.purpose !== me.purpose);
    // The light index of a final cut has no capture time of its own, so look wider for it.
    const wider = me.purpose === "library" ? await finalCuts() : [];
    for (const f of new Map([...finals, ...wider].map((x) => [x._id, x])).values()) {
      const [lib, fin] = me.purpose === "library" ? [me, f] : [f, me];
      const lf = factsOf(lib);
      const ff = factsOf(fin);
      if (lf && ff && matchesFinalCut(lf, ff)) await recordFinalCut(lib, fin);
    }
  }

  async function finalCuts() {
    return items.find({ purpose: "final-cut", kind: "video", "index.status": "indexed" }, { projection: { embedding: 0 } }).toArray();
  }

  async function recordFinalCut(lib: LibraryItemDoc, fin: LibraryItemDoc) {
    const _id = `${fin._id}:${lib._id}`;
    if (await duplicates.findOne({ _id })) return;
    const d: DuplicateDoc = {
      _id,
      keepId: fin._id,
      otherId: lib._id,
      verdict: "final-cut",
      evidence: { secondsApart: 0, subsecMatch: null, hashDistance: 0, durationDiff: Math.abs((lib.durationS ?? 0) - (fin.durationS ?? 0)), sameBytes: !!lib.contentHash && lib.contentHash === fin.contentHash },
      betterFile: "keep",
      status: "open",
      createdAt: new Date(),
    };
    await duplicates.insertOne(d);
    await items.updateOne({ _id: lib._id }, { $set: { excluded: true } });
  }

  async function recordPair(older: LibraryItemDoc, newer: LibraryItemDoc, m: Match) {
    const _id = `${older._id}:${newer._id}`;
    if (await duplicates.findOne({ _id })) return; // decided before (kept-both is remembered for good)
    const same = m.verdict === "same";
    await duplicates.insertOne({
      _id,
      keepId: older._id,
      otherId: newer._id,
      ...m,
      status: same ? "waiting" : "open",
      ...(same ? { mergeAfter: new Date(Date.now() + UNDO_MS) } : {}),
      createdAt: new Date(),
    });
    if (same) await items.updateOne({ _id: newer._id }, { $set: { hiddenAsDuplicateOf: older._id } });
  }
}

// ---------- Review ----------

export async function listDuplicates(status: "open" | "waiting") {
  const { items, duplicates } = await collections();
  const docs = await duplicates.find({ status }).sort({ createdAt: -1 }).limit(100).toArray();
  const ids = [...new Set(docs.flatMap((d) => [d.keepId, d.otherId]))];
  const found = await items.find({ _id: { $in: ids } }, { projection: { embedding: 0 } }).toArray();
  const views = new Map((await viewsOf(found)).map((v) => [v.id, v]));
  return docs.flatMap((d) => {
    const keep = views.get(d.keepId);
    const other = views.get(d.otherId);
    return keep && other ? [{ id: d._id, verdict: d.verdict, status: d.status, evidence: d.evidence, betterFile: d.betterFile, mergeAfter: d.mergeAfter?.toISOString() ?? null, keep, other }] : [];
  });
}

export async function countOpenDuplicates(): Promise<number> {
  const { duplicates } = await collections();
  return duplicates.countDocuments({ status: "open" });
}

export type Resolution = "merge" | "keep-both" | "undo";

export async function resolveDuplicate(id: string, action: Resolution): Promise<void> {
  const { items, duplicates } = await collections();
  const d = await duplicates.findOne({ _id: id });
  if (!d) throw new HttpError(404, "Not found");

  if (action === "merge") {
    if (d.verdict === "final-cut") throw new HttpError(400, "A final cut can only be kept as a library clip or left out");
    await mergePair(d);
    return;
  }
  if (action === "undo" && d.status !== "waiting") throw new HttpError(409, "Only a pending merge can be undone");
  if (action === "keep-both" && d.status !== "open") throw new HttpError(409, "Already decided");
  const status = action === "undo" ? "undone" : "kept-both";
  await duplicates.updateOne({ _id: id }, { $set: { status, resolvedAt: new Date() }, $unset: { mergeAfter: "" } });
  if (action === "undo") await items.updateOne({ _id: d.otherId }, { $unset: { hiddenAsDuplicateOf: "" } });
  if (d.verdict === "final-cut") await items.updateOne({ _id: d.otherId }, { $set: { excluded: false } }); // you said it's footage
}

/** Folds the newer item into the older one (docs/TRD.md §4.1). */
async function mergePair(d: DuplicateDoc): Promise<void> {
  const { items, duplicates } = await collections();
  const claimed = await duplicates.updateOne({ _id: d._id, status: { $in: ["waiting", "open"] } }, { $set: { status: "merged", resolvedAt: new Date() }, $unset: { mergeAfter: "" } });
  if (!claimed.matchedCount) return; // someone else got there first
  const takeNewer = d.betterFile === "other";
  try {
    await storage().mergeAssets(d.keepId, d.otherId, takeNewer ? "from" : "this");
  } catch (err) {
    // Already merged in storage, or an item vanished: carry on; anything else: undo the claim.
    if (!(err instanceof StorageError && err.status === 404)) {
      await duplicates.updateOne({ _id: d._id }, { $set: { status: d.status, ...(d.mergeAfter ? { mergeAfter: d.mergeAfter } : {}) }, $unset: { resolvedAt: "" } });
      throw err;
    }
  }
  await items.deleteOne({ _id: d.otherId });
  const { plans } = await collections();
  const refs = ["shots.libraryItemId", "shots.alternates.libraryItemId", "shots.takes.libraryItemId"].map((k) => ({ [k]: d.otherId }));
  for (const plan of await plans.find({ $or: refs }, { projection: { shots: 1 } }).toArray()) {
    await plans.updateOne({ _id: plan._id }, { $set: { shots: repoint(plan.shots, d.otherId, d.keepId) }, $inc: { version: 1 } });
  }
  if (takeNewer) {
    // The original changed, so the thumbnail, proxy and tags may no longer match it.
    await items.updateOne({ _id: d.keepId }, { $set: { "index.status": "pending", "index.at": new Date(), variants: { proxy: false, thumb: false } } });
    await enqueue("index-asset", { itemId: d.keepId });
  }
}

let lastMerge = 0;

/** Merges pairs whose undo window has passed. Runs in the background, at most hourly. */
export function mergeDueSoon(): void {
  if (Date.now() - lastMerge < 3600_000) return;
  lastMerge = Date.now();
  after(async () => {
    const { duplicates } = await collections();
    for (const d of await duplicates.find({ status: "waiting", mergeAfter: { $lte: new Date() } }).limit(50).toArray()) {
      await mergePair(d).catch((err: unknown) => console.error("merge failed", d._id, err));
    }
  });
}
