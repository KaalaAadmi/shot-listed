import "server-only";
import { randomUUID } from "node:crypto";
import { HttpError } from "./auth";
import { captionWriter } from "./finals";
import { collections } from "./db";
import { enqueue } from "./jobs";
import { analysisSchema, checkConcept, type Concept, type Viability, conceptText, coverageText, judgeSchema, reelUrl, shortcodeOf, viabilityOf } from "./inspiration-rules.ts";
import { captionVoice, getSettings } from "./library";
import { likelyClips } from "./library-items";
import { notify } from "./notify";
import { createPlan, recentFormats } from "./plans";
import { promptStamp, renderPrompt } from "./prompts.ts";
import { getRuns, recordStep, resetRun, startRun } from "./runs";
import { INSPIRATIONS, storage } from "./storage/connector.ts";
import type { InspirationDoc, InspirationMeta, InspirationView } from "./types";

// Shared reels: the Shortcut sends a link; the pipeline host downloads and watches it (jobs
// `ingest-inspiration` and `analyse-inspiration`); this file saves the analysis, scores it and
// keeps the Inbox in step. Rules for the score are in inspiration-rules.ts.

const STEPS = ["Downloading", "Watching", "Scoring"];

const LABEL = { make: "Make now", twist: "Make with a twist", skip: "Skip" } as const;

// ---------- Sharing ----------

/** A link from the Shortcut or the Inbox, or a file you uploaded by hand (`assetId`, from the "inspiration" upload purpose). */
export async function share(input: { url?: string; assetId?: string; note: string }): Promise<{ id: string; existing: boolean }> {
  const { inspirations } = await collections();
  const note = input.note.trim();
  const now = new Date();
  const id = randomUUID();

  let doc: InspirationDoc;
  if (input.assetId) {
    const { asset } = await storage().getAsset(input.assetId);
    if (asset.collection !== INSPIRATIONS || asset.status !== "uploaded") throw new HttpError(404, "Upload not found");
    const existing = await inspirations.findOne({ storageAssetId: asset.id });
    if (existing) return { id: existing._id, existing: true };
    doc = { _id: id, url: "", source: "upload", note, status: "analysing", storageAssetId: asset.id, runId: "", createdAt: now, updatedAt: now };
  } else {
    const shortcode = shortcodeOf(input.url ?? "");
    if (!shortcode) throw new HttpError(400, "That doesn't look like an Instagram reel link");
    const existing = await inspirations.findOne({ shortcode });
    if (existing) return { id: existing._id, existing: true };
    doc = { _id: id, url: reelUrl(shortcode), shortcode, source: "share", note, status: "queued", runId: "", createdAt: now, updatedAt: now };
  }

  doc.runId = await startRun("inspiration", id, STEPS);
  await inspirations.insertOne(doc);
  if (doc.source === "upload") {
    await recordStep(doc.runId, "Downloading", { status: "skipped", summary: "Uploaded by hand" });
    await enqueue("analyse-inspiration", { inspirationId: id }, doc.runId);
  } else {
    await enqueue("ingest-inspiration", { inspirationId: id }, doc.runId);
  }
  return { id, existing: false };
}

async function load(id: string): Promise<InspirationDoc> {
  const { inspirations } = await collections();
  const doc = await inspirations.findOne({ _id: id });
  if (!doc) throw new HttpError(404, "Not found");
  return doc;
}

// ---------- What the host reports ----------

export async function forHost(id: string) {
  const d = await load(id);
  return { url: d.url, note: d.note, storageAssetId: d.storageAssetId ?? null, meta: d.meta ?? null, runId: d.runId };
}

/** The reel is in storage: remember it and queue the watching. */
export async function recordIngested(id: string, storageAssetId: string, meta: InspirationMeta): Promise<void> {
  const d = await load(id);
  const { inspirations } = await collections();
  await inspirations.updateOne({ _id: id }, { $set: { storageAssetId, meta, status: "analysing", updatedAt: new Date() }, $unset: { error: "" } });
  await recordStep(d.runId, "Downloading", { status: "done", summary: meta.creator ? `From @${meta.creator}` : undefined });
  await enqueue("analyse-inspiration", { inspirationId: id }, d.runId);
}

/** The host watched the reel. Save what it saw, then score it. */
export async function recordAnalysis(id: string, raw: unknown): Promise<void> {
  const d = await load(id);
  const parsed = analysisSchema.parse(raw);
  const concept = checkConcept(parsed.concept, d.meta?.audio.title ?? "unknown");
  const { inspirations } = await collections();
  await inspirations.updateOne(
    { _id: id },
    { $set: { analysis: { ...parsed, concept }, concept, analysisPrompt: promptStamp("inspiration-analysis"), updatedAt: new Date() } },
  );
  await recordStep(d.runId, "Watching", { status: "done", summary: concept.format });
  await score(id);
}

const statsText = (m: InspirationMeta | undefined) => {
  const n = (v: number | null | undefined) => (v == null ? "unknown" : v.toLocaleString("en"));
  return m ? `Views ${n(m.views)} · Likes ${n(m.likes)} · Comments ${n(m.comments)} · Shares unknown` : "";
};

/** The viability judge for a concept, from someone else's reel or your own idea. Shared with ideas. */
export async function judge(concept: Concept, source: "other" | "own", stats = ""): Promise<{ viability: Viability; prompt: string }> {
  const voice = captionVoice(await getSettings());
  const counts = await likelyClips(concept.beats.map((b) => b.shows));
  const p = renderPrompt("viability-judge", {
    creatorProfile: voice.creatorProfile,
    contentHistory: voice.contentHistory,
    recentFormats: await recentFormats(),
    source: source === "other" ? "Someone else's reel I saved" : "My own idea",
    concept: conceptText(concept),
    stats,
    coverage: coverageText(counts),
  });
  const raw = await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature });
  return { viability: viabilityOf(judgeSchema.parse(raw), counts, source), prompt: p.prompt };
}

/** Judges the saved concept. Never throws: a failure is written to the reel for Retry. Safe to run again. */
export async function score(id: string): Promise<void> {
  const d = await load(id);
  if (!d.concept) throw new HttpError(409, "Not watched yet");
  const { inspirations } = await collections();
  try {
    await recordStep(d.runId, "Scoring", { status: "running" });
    const { viability, prompt } = await judge(d.concept, "other", statsText(d.meta));
    await inspirations.updateOne(
      { _id: id },
      { $set: { viability, viabilityPrompt: prompt, status: viability.verdict === "skip" ? "skipped" : "scored", updatedAt: new Date() }, $unset: { error: "" } },
    );
    await recordStep(d.runId, "Scoring", { status: "done", summary: `${viability.score} · ${LABEL[viability.verdict]}` });
    const base = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    await notify(`${LABEL[viability.verdict]} (${viability.score}): ${d.concept.title}. ${viability.reason}`, base ? `https://${base}/inbox` : undefined);
  } catch (err) {
    console.error(`Scoring ${id} failed:`, err);
    await markFailed(id, err instanceof Error ? err.message : String(err));
  }
}

/** The step that was running (or next) fails, and the Inbox shows Retry. */
export async function markFailed(id: string, error: string): Promise<void> {
  const { inspirations, runs } = await collections();
  const d = await inspirations.findOne({ _id: id });
  if (!d) return;
  await inspirations.updateOne({ _id: id }, { $set: { status: "failed", error: error.slice(0, 300), updatedAt: new Date() } });
  const run = await runs.findOne({ _id: d.runId });
  const step = run?.steps.find((s) => s.status === "running") ?? run?.steps.find((s) => s.status === "waiting");
  if (step) await recordStep(d.runId, step.name, { status: "failed", error: error.slice(0, 300) });
}

// ---------- What you do ----------

/** Retry picks up where it stopped: judge again, watch again, or download again. */
export async function retry(id: string): Promise<void> {
  const d = await load(id);
  if (d.status !== "failed") throw new HttpError(409, "Nothing to retry");
  const { inspirations } = await collections();
  await resetRun(d.runId, STEPS);
  if (d.storageAssetId) await recordStep(d.runId, "Downloading", { status: "done" });
  if (d.concept) {
    await recordStep(d.runId, "Watching", { status: "done" });
    await inspirations.updateOne({ _id: id }, { $set: { status: "analysing", updatedAt: new Date() }, $unset: { error: "" } });
    await score(id);
    return;
  }
  const next = d.storageAssetId ? "analyse-inspiration" : "ingest-inspiration";
  await inspirations.updateOne({ _id: id }, { $set: { status: d.storageAssetId ? "analysing" : "queued", updatedAt: new Date() }, $unset: { error: "" } });
  await enqueue(next, { inspirationId: id }, d.runId);
}

/** Instagram wouldn't give the reel to the host: attach a file you uploaded by hand and watch that instead. */
export async function attachFile(id: string, assetId: string): Promise<void> {
  const d = await load(id);
  if (d.storageAssetId) throw new HttpError(409, "This one already has its video");
  const { asset } = await storage().getAsset(assetId);
  if (asset.collection !== INSPIRATIONS || asset.status !== "uploaded") throw new HttpError(404, "Upload not found");
  const { inspirations } = await collections();
  await inspirations.updateOne({ _id: id }, { $set: { storageAssetId: assetId, status: "analysing", updatedAt: new Date() }, $unset: { error: "" } });
  await resetRun(d.runId, STEPS);
  await recordStep(d.runId, "Downloading", { status: "skipped", summary: "Uploaded by hand" });
  await enqueue("analyse-inspiration", { inspirationId: id }, d.runId);
}

/** Make (or Make anyway on a Skip). */
export async function make(id: string): Promise<string> {
  const d = await load(id);
  if (!d.viability || !d.concept) throw new HttpError(409, "Wait for the verdict first");
  const { inspirations } = await collections();
  await inspirations.updateOne(
    { _id: id },
    { $set: { status: "scored", ...(d.status === "skipped" ? { overridden: true } : {}), updatedAt: new Date() } },
  );
  return createPlan("inspiration", id);
}

// ---------- Reads ----------

function toView(d: InspirationDoc, steps: InspirationView["steps"]): InspirationView {
  return {
    id: d._id,
    url: d.url,
    source: d.source,
    note: d.note,
    status: d.status,
    title: d.concept?.title ?? d.meta?.caption.slice(0, 80) ?? d.url ?? "Uploaded reel",
    creator: d.meta?.creator || null,
    steps,
    viability: d.viability ?? null,
    concept: d.concept ?? null,
    hasVideo: !!d.storageAssetId,
    overridden: !!d.overridden,
    planId: d.planId ?? null,
    error: d.error ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function listInspirations(): Promise<InspirationView[]> {
  const { inspirations } = await collections();
  const docs = await inspirations.find().sort({ createdAt: -1 }).limit(50).toArray();
  const runs = await getRuns(docs.map((d) => d.runId));
  return docs.map((d) =>
    toView(d, (runs.get(d.runId) ?? []).map((s) => ({ name: s.name, status: s.status, summary: s.summary ?? null }))),
  );
}
