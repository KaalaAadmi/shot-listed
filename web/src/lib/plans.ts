import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { HttpError } from "./auth";
import { foldChat, threadText } from "./chat";
import { collections } from "./db";
import { captionWriter, visionModel } from "./finals";
import { conceptText, type Concept } from "./inspiration-rules.ts";
import { captionVoice, getSettings, updateSettings } from "./library";
import { nearest, viewsOf } from "./library-items";
import { enqueue } from "./jobs";
import { searchStock } from "./pexels";
import {
  addTake,
  applyOperations,
  applyTakeResult,
  applyWriting,
  cardText,
  failTake as failTakeShot,
  overrideTake as overrideTakeShot,
  checkGrades,
  chatSchema,
  formatsText,
  appendHistory,
  historyDraftSchema,
  numbersText,
  type HistoryDraft,
  type Numbers,
  type PlanStatus,
  commit,
  isShootDay,
  isStockAppropriate,
  placeAll,
  placeStock,
  takeResultSchema,
  shotsFromConcept,
  shotsText,
  stockQuery,
  toFilmIt,
  undo as undoVersion,
  withClips,
  writerSchema,
  type Alternate,
  type Candidate,
  type ChatTurn,
  type Graded,
  type PlanDoc,
  type PlanShot,
  type PlanView,
} from "./plan-rules.ts";
import { promptStamp, renderPrompt } from "./prompts.ts";
import { getRuns, recordStep, resetRun, startRun } from "./runs";
import { storage } from "./storage/connector.ts";
import type { LibraryItemDoc } from "./types";

// A plan is built in the web app's background (`after()`), not on the pipeline host: matching 5–10 beats against the
// library is a handful of model calls and finishes well inside Vercel's 300 s. docs/TRD.md §4 describes it as a host job;
// move it there if plans ever get slower than that.

export const STEPS = ["Matching clips", "Stock footage", "Writing"] as const;
type Step = (typeof STEPS)[number];
const SHORT: Record<string, Step> = { matching: STEPS[0], stock: STEPS[1], writing: STEPS[2] };
export type From = keyof typeof SHORT;

const CANDIDATES = 5;

async function load(id: string): Promise<PlanDoc> {
  const { plans } = await collections();
  const plan = await plans.findOne({ _id: id });
  if (!plan) throw new HttpError(404, "Not found");
  return plan;
}

// ---------- Where a plan's concept comes from ----------

async function sourceOf(kind: PlanDoc["source"]["kind"], id: string) {
  if (kind === "idea") {
    const { ideas } = await collections();
    const i = await ideas.findOne({ _id: id });
    if (!i?.brief) throw new HttpError(409, "Make the brief first");
    return { concept: i.brief, audioTitle: "", url: "", own: true };
  }
  const { inspirations } = await collections();
  const d = await inspirations.findOne({ _id: id });
  if (!d?.concept) throw new HttpError(409, "That reel hasn't been watched yet");
  return { concept: d.concept, audioTitle: d.meta?.audio.title ?? "", url: d.url, own: false };
}

/** Starts a plan for an inspiration or an idea and builds it in the background. */
export async function createPlan(kind: PlanDoc["source"]["kind"], sourceId: string): Promise<string> {
  const { plans } = await collections();
  const existing = await plans.findOne({ "source.kind": kind, "source.id": sourceId });
  if (existing) return existing._id;
  const src = await sourceOf(kind, sourceId);
  const id = randomUUID();
  const now = new Date();
  const shots = shotsFromConcept(src.concept);
  const plan: PlanDoc = {
    _id: id,
    source: { kind, id: sourceId },
    concept: src.concept,
    title: src.concept.title,
    format: src.concept.format,
    status: "planned",
    build: "building",
    shootDay: isShootDay(shots),
    hooks: [],
    shots,
    audio: { inspiration: { title: src.audioTitle, url: src.url }, searchTerms: src.concept.audio.searchTerms, vibe: src.concept.audio.idea, useInspirationSound: false, note: "" },
    editNotes: [],
    clipPack: { status: "none" },
    runId: await startRun("plan", id, [...STEPS]),
    version: 1,
    history: [],
    chat: [],
    createdAt: now,
    updatedAt: now,
  };
  await plans.insertOne(plan);
  after(() => buildPlan(id, "matching"));
  return id;
}

/** Re-runs from a step to the end (a failed build, or the pipeline view's "Retry from here"). */
export async function rerun(id: string, from: From): Promise<void> {
  const plan = await load(id);
  if (plan.build === "building") throw new HttpError(409, "Already working on this one");
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { build: "building", updatedAt: new Date() }, $unset: { error: "" } });
  await resetRun(plan.runId, [...STEPS]);
  for (const name of STEPS.slice(0, STEPS.indexOf(SHORT[from]))) await recordStep(plan.runId, name, { status: "done" });
  after(() => buildPlan(id, from));
}

// ---------- Matching ----------

const header = (c: Concept) => `Title: ${c.title}\nFormat: ${c.format}\nHook: ${c.hook}`;

async function fetchImage(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not read a thumbnail (${res.status})`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

/** The five closest library items for a description, graded by looking at them. */
// ponytail: videos are graded on their one thumbnail, not the three frames clip-grader.md describes; add frames when grades miss.
async function gradeBeat(concept: Concept, beat: string, seconds: number, label: string): Promise<Graded> {
  const docs = (await nearest(beat, CANDIDATES)).filter((d: LibraryItemDoc) => d.variants.thumb);
  if (!docs.length) return { alternates: [], best: -1 };
  const { urls } = await storage().getUrls(docs.map((d) => ({ id: d._id, variant: "thumb" })));
  const byId = new Map(urls.map((u) => [u.id, u.url]));
  const candidates: Candidate[] = docs.map((d) => ({ id: d._id, label: d.tags?.caption ?? d.filename, kind: d.kind, durationS: d.durationS ?? 0 }));
  const images = await Promise.all(docs.map((d) => fetchImage(byId.get(d._id)!)));
  const describe = (d: LibraryItemDoc, i: number) => {
    const q = d.tags?.quality;
    const quality = q ? [q.sharp ? "sharp" : "soft", q.wellLit ? "well lit" : "dim", q.stable ? "steady" : "shaky"].join(", ") : "unknown";
    const shape = d.width && d.height ? (d.width === d.height ? "square" : d.width > d.height ? "horizontal" : "vertical") : "unknown";
    return `Candidate ${i + 1} · ${d.kind}${d.kind === "video" ? ` · ${(d.durationS ?? 0).toFixed(1)} s` : ""} · ${shape} · tagged: "${d.tags?.caption ?? d.filename}" · quality: ${quality}`;
  };
  const p = renderPrompt("clip-grader", { concept: header(concept), beat: `${label} · ${seconds} s · shows: ${beat}`, candidates: docs.map(describe).join("\n") });
  const raw = await visionModel().generateJson({
    system: p.system,
    parts: [{ text: p.user }, ...images.flatMap((base64, i) => [{ text: `Candidate ${i + 1}:` }, { image: { mimeType: "image/jpeg", base64 } }])],
    schema: p.schema,
    temperature: p.temperature,
  });
  return checkGrades(raw, candidates, seconds);
}

// ---------- Writing ----------

async function write(plan: Pick<PlanDoc, "concept" | "source" | "audio">, shots: PlanShot[]) {
  const voice = captionVoice(await getSettings());
  const p = renderPrompt("plan-writer", {
    creatorProfile: voice.creatorProfile,
    contentHistory: voice.contentHistory,
    source: plan.source.kind === "inspiration" ? "Based on someone else's reel" : "My own idea",
    concept: conceptText(plan.concept),
    shots: shotsText(shots),
    audio: `Idea: ${plan.concept.audio.idea}${plan.audio.inspiration.title && plan.audio.inspiration.title !== "unknown" ? `\nOriginal sound: ${plan.audio.inspiration.title}` : ""}`,
  });
  const raw = await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature });
  return writerSchema.parse(raw);
}

/** Film it cards that have no directions yet (added in the chat). Quietly skips if the plan moved on meanwhile. */
async function fillDirections(id: string): Promise<void> {
  try {
    const plan = await load(id);
    if (!plan.shots.some((s) => s.source === "film_it" && (s.filmIt?.recordSeconds ?? 0) === 0)) return;
    const shots = applyWriting(plan.shots, await write(plan, plan.shots), true);
    const { plans } = await collections();
    await plans.updateOne({ _id: id, version: plan.version }, { $set: { shots, updatedAt: new Date() } });
  } catch (err) {
    console.error(`Directions for plan ${id} failed:`, err);
  }
}

// ---------- Building ----------

/** Never throws: a failure is written to the plan and its run, and the screen offers Retry. */
export async function buildPlan(id: string, from: From): Promise<void> {
  const { plans } = await collections();
  let step: Step = SHORT[from];
  try {
    const plan = await load(id);
    const first = !plan.prompts;
    let shots = from === "matching" ? shotsFromConcept(plan.concept) : plan.shots;
    const prompts: Record<string, string> = { ...plan.prompts };

    if (from === "matching") {
      await recordStep(plan.runId, step, { status: "running" });
      const beats = plan.concept.beats;
      const graded = await Promise.all(
        shots.map((s, i) => gradeBeat(plan.concept, s.beat, s.seconds, `Shot ${i + 1} of ${shots.length}`).catch((err: unknown) => {
          console.error(`Grading shot ${i + 1} failed:`, err);
          return { alternates: [] as Alternate[], best: -1 };
        })),
      );
      shots = placeAll(shots, graded);
      // Keep the reel's own on-screen text per beat as a starting point; the writer replaces it.
      shots = shots.map((s, i) => ({ ...s, onScreenText: beats[i]?.onScreenText ?? "" }));
      prompts.grader = promptStamp("clip-grader");
      const placed = shots.filter((s) => s.source === "library").length;
      await recordStep(plan.runId, step, { status: "done", summary: `${placed} of ${shots.length} from your library` });
      step = STEPS[1];
    }

    if (step === STEPS[1]) {
      await recordStep(plan.runId, step, { status: "running" });
      let stocked = 0;
      shots = await Promise.all(
        shots.map(async (s) => {
          if (s.source !== "film_it" || !isStockAppropriate(s.beat)) return s;
          try {
            const hit = (await searchStock(stockQuery(s.beat))).find((r) => r.duration >= s.seconds);
            if (!hit) return s;
            stocked++;
            return placeStock(s, { pexelsId: hit.pexelsId, url: hit.url, credit: hit.credit });
          } catch (err) {
            console.error("Stock search failed:", err);
            return s;
          }
        }),
      );
      await recordStep(plan.runId, step, { status: "done", summary: stocked ? `${stocked} stock clip${stocked === 1 ? "" : "s"}` : "None needed" });
      step = STEPS[2];
    }

    await recordStep(plan.runId, step, { status: "running" });
    const w = await write(plan, shots);
    shots = applyWriting(shots, w);
    prompts.writer = promptStamp("plan-writer");
    const filmIt = shots.filter((s) => s.source === "film_it").length;
    await recordStep(plan.runId, step, { status: "done", summary: filmIt ? `${filmIt} to film` : "All shots covered" });

    const patch = first
      ? { shots, shootDay: isShootDay(shots) }
      : commit(plan, shots, `Re-ran ${from}`);
    await plans.updateOne(
      { _id: id },
      {
        $set: {
          ...patch,
          hooks: w.hooks.slice(0, 3),
          audio: { ...plan.audio, searchTerms: w.audio.searchTerms.length ? w.audio.searchTerms : plan.audio.searchTerms, vibe: w.audio.vibe, useInspirationSound: w.audio.useInspirationSound, note: w.audio.note },
          editNotes: w.editNotes.slice(0, 4),
          build: "ready",
          prompts,
          updatedAt: new Date(),
        },
        $unset: { error: "" },
      },
    );
    const { inspirations, ideas } = await collections();
    const mark = { $set: { status: "planned" as const, planId: id, updatedAt: new Date() } };
    if (plan.source.kind === "inspiration") await inspirations.updateOne({ _id: plan.source.id }, mark);
    else await ideas.updateOne({ _id: plan.source.id }, mark);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Plan ${id} failed at ${step}:`, err);
    const plan = await plans.findOne({ _id: id });
    await plans.updateOne({ _id: id }, { $set: { build: "failed", error: message.slice(0, 300), updatedAt: new Date() } }).catch(() => undefined);
    if (plan) await recordStep(plan.runId, step, { status: "failed", error: message }).catch(() => undefined);
  }
}

// ---------- Reading ----------

export async function getPlan(id: string): Promise<PlanView> {
  const plan = await load(id);
  const { items } = await collections();
  const ids = [...new Set(plan.shots.flatMap((s) => [s.libraryItemId, ...s.alternates.map((a) => a.libraryItemId), ...s.takes.map((t) => t.libraryItemId)]).filter((x): x is string => !!x))];
  const docs = await items.find({ _id: { $in: ids } }, { projection: { embedding: 0 } }).toArray();
  const views = await viewsOf(docs);
  const { history, createdAt, postedAt, ...rest } = plan;
  const steps = (await getRuns([plan.runId])).get(plan.runId) ?? [];
  const pack = plan.clipPack.storageAssetId ? (await storage().getUrl(plan.clipPack.storageAssetId, { download: true }).catch(() => null))?.url ?? null : null;
  return {
    ...rest,
    packUrl: pack,
    postedAt: postedAt?.toISOString() ?? null,
    canUndo: history.length > 0,
    steps: steps.map((s) => ({ name: s.name, status: s.status, summary: s.summary ?? null, error: s.error ?? null })),
    clips: Object.fromEntries(views.map((v) => [v.id, { url: v.url, kind: v.kind, thumb: v.thumb }])),
    createdAt: createdAt.toISOString(),
  };
}

// ---------- Editing: swap, chat, undo ----------

async function save(plan: PlanDoc, patch: Record<string, unknown>, turns: ChatTurn[] = []): Promise<void> {
  const { plans } = await collections();
  // The version guard stops two edits from overwriting each other.
  const res = await plans.updateOne(
    { _id: plan._id, version: plan.version },
    { $set: { ...patch, updatedAt: new Date() }, ...(turns.length ? { $push: { chat: { $each: turns } } } : {}) },
  );
  if (!res.matchedCount) throw new HttpError(409, "The plan changed while you were doing that. Try again.");
}

/** Tap an alternate (1-based, as in the chat) to use it: the same as use_alternate. */
export async function swapAlternate(id: string, shotId: string, alternate: number): Promise<void> {
  const plan = await load(id);
  const shot = plan.shots.find((s) => s.id === shotId);
  if (!shot) throw new HttpError(404, "No such shot");
  const edit = applyOperations(plan.shots, [{ op: "use_alternate", shot: shot.n, toPosition: 0, seconds: 0, text: "", alternate, description: "" }]);
  if (!edit.ok) throw new HttpError(409, edit.error);
  await save(plan, commit(plan, edit.shots, `Used another clip for shot ${shot.n}`));
}

export async function undo(id: string): Promise<void> {
  const plan = await load(id);
  const back = undoVersion(plan);
  if (!back) throw new HttpError(409, "Nothing to undo");
  // Version numbers keep rising so the guard in save() still protects against stale writes.
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { ...back, updatedAt: new Date() } });
}

export async function sendMessage(id: string, text: string): Promise<void> {
  const plan = await load(id);
  if (plan.build !== "ready") throw new HttpError(409, "The plan isn't ready yet");
  if (plan.shots.some((s) => s.searching)) throw new HttpError(409, "Still looking for clips. One moment.");
  const voice = captionVoice(await getSettings());
  const p = renderPrompt("plan-chat", {
    creatorProfile: voice.creatorProfile,
    concept: conceptText(plan.concept),
    plan: `Version ${plan.version}\n${shotsText(plan.shots)}`,
    thread: threadText(plan.chat, plan.folded ?? 0, plan.summary),
    message: text,
  });
  const out = chatSchema.parse(await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature }));

  const now = new Date();
  let reply = out.reply;
  let patch: Record<string, unknown> = {};
  let finds: { shotId: string; description: string }[] = [];
  let applied = false;
  if (out.operations.length) {
    const edit = applyOperations(plan.shots, out.operations);
    if (!edit.ok) reply = `${out.reply} ${edit.error} I haven't changed anything.`;
    else {
      const searching = new Set(edit.finds.map((f) => f.shot));
      const shots = edit.shots.map((s) => (searching.has(s.n) ? { ...s, searching: true } : s));
      patch = commit(plan, shots, text.slice(0, 80), now);
      finds = edit.finds.map((f) => ({ shotId: shots[f.shot - 1].id, description: f.description }));
      applied = true;
    }
  }
  const turns: ChatTurn[] = [
    { at: now.toISOString(), role: "you", text },
    { at: now.toISOString(), role: "model", text: reply, ...(applied ? { operations: out.operations, version: plan.version + 1 } : {}) },
  ];
  await save(plan, { ...patch, prompts: { ...plan.prompts, chat: p.prompt } }, turns);

  if (finds.length) after(() => runFinds(id, finds));
  else if (applied) after(() => fillDirections(id));
  after(async () => {
    const fresh = await load(id).catch(() => null);
    if (!fresh) return;
    const folded = await foldChat("plan chat", fresh.chat, fresh.folded ?? 0, fresh.summary).catch(() => null);
    if (folded) await (await collections()).plans.updateOne({ _id: id }, { $set: folded });
  });
}

/** `find_clip`: search and grade again for each shot, then say what happened in the chat. */
async function runFinds(id: string, finds: { shotId: string; description: string }[]): Promise<void> {
  const notes: string[] = [];
  for (const f of finds) {
    let message: string;
    let graded: Graded = { alternates: [], best: -1 };
    try {
      const plan = await load(id);
      const shot = plan.shots.find((s) => s.id === f.shotId);
      if (!shot) continue;
      graded = await gradeBeat(plan.concept, f.description, shot.seconds, `Shot ${shot.n} of ${plan.shots.length}`);
      // The clip that was there stays on offer as an alternate.
      const prior = shot.source === "library" ? toFilmIt({ ...shot, alternates: [] }).alternates : [];
      const found = graded.alternates.filter((a) => !prior.some((p) => p.libraryItemId === a.libraryItemId));
      const pick = graded.best >= 0 ? found.findIndex((a) => a.libraryItemId === graded.alternates[graded.best].libraryItemId) : -1;
      const updated = { ...withClips({ ...shot, alternates: [...prior, ...shot.alternates.filter((a) => !found.some((x) => x.libraryItemId === a.libraryItemId))] }, found, pick), searching: undefined };
      message = pick >= 0 ? `Found a clip for shot ${shot.n} (${found[pick].fit}): ${found[pick].label}.` : `Nothing in your library fits shot ${shot.n}, so it's now a Film it card.`;
      const shots = plan.shots.map((s) => (s.id === shot.id ? updated : s));
      // ponytail: if you edited the plan while this ran, the version guard drops the result; ask again.
      await save(plan, commit(plan, shots, `Looked for a clip for shot ${shot.n}`));
    } catch (err) {
      console.error(`Finding a clip for plan ${id} failed:`, err);
      message = "I couldn't search just now. Try again in a moment.";
      const { plans } = await collections();
      await plans.updateOne({ _id: id, "shots.id": f.shotId }, { $unset: { "shots.$.searching": "" } });
    }
    notes.push(message);
  }
  const { plans } = await collections();
  // Any searching flag still up (a guard that dropped the result) is cleared.
  await plans.updateOne({ _id: id }, { $unset: { "shots.$[].searching": "" } });
  if (notes.length) await plans.updateOne({ _id: id }, { $push: { chat: { at: new Date().toISOString(), role: "model", text: notes.join(" ") } } });
  await fillDirections(id);
}

export type PlanSummary = { id: string; title: string; format: string; status: PlanDoc["status"]; build: PlanDoc["build"]; shootDay: boolean; shots: number; filmIt: number; postedAt: string | null; updatedAt: string };

export async function listPlans(): Promise<PlanSummary[]> {
  const { plans } = await collections();
  const docs = await plans.find({}, { projection: { chat: 0, history: 0 } }).sort({ updatedAt: -1 }).limit(100).toArray();
  return docs.map((p) => ({
    id: p._id,
    title: p.title,
    format: p.format,
    status: p.status,
    build: p.build,
    shootDay: p.shootDay,
    shots: p.shots.length,
    filmIt: p.shots.filter((s) => s.source === "film_it").length,
    postedAt: p.postedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));
}

/** The last ten posted reels' formats, for freshness checks (viability judge, idea coach). */
export async function recentFormats(): Promise<string> {
  const { plans } = await collections();
  const posted = await plans.find({ postedAt: { $exists: true } }, { projection: { format: 1, title: 1, postedAt: 1 } }).sort({ postedAt: -1 }).limit(10).toArray();
  return formatsText(posted.map((p) => ({ format: p.format, title: p.title, postedAt: p.postedAt! })));
}

// ---------- Takes and the clip pack (phase 9) ----------

/** Changes one shot without a new version, but bumps `version` so a chat edit that read the old plan can't overwrite it. */
async function patchShot(id: string, shotId: string, fn: (s: PlanShot) => PlanShot | null, extra: Record<string, unknown> = {}): Promise<void> {
  const { plans } = await collections();
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await load(id);
    const shot = plan.shots.find((s) => s.id === shotId);
    if (!shot) throw new HttpError(404, "No such shot");
    const next = fn(shot);
    if (!next) throw new HttpError(404, "No such take");
    const res = await plans.updateOne(
      { _id: id, version: plan.version },
      { $set: { shots: plan.shots.map((s) => (s.id === shotId ? next : s)), ...extra, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    if (res.matchedCount) return;
  }
  throw new HttpError(409, "The plan changed while you were doing that. Try again.");
}

/** You uploaded a take (a library item) for a Film it card: check it on the host. */
export async function attachTake(id: string, shotId: string, assetId: string): Promise<void> {
  const plan = await load(id);
  const { items } = await collections();
  const item = await items.findOne({ _id: assetId }, { projection: { kind: 1 } });
  if (!item) throw new HttpError(404, "That upload isn't in the library yet");
  if (item.kind !== "video") throw new HttpError(400, "A take must be a video");
  await patchShot(id, shotId, (s) => addTake(s, assetId), plan.status === "planned" ? { status: "filming" } : {});
  await enqueue("check-take", { planId: id, shotId, assetId });
}

/** Use anyway. */
export async function overrideTake(id: string, shotId: string, assetId: string): Promise<void> {
  await patchShot(id, shotId, (s) => overrideTakeShot(s, assetId));
}

/** For the host's `check-take` job. */
export async function takeContext(id: string, shotId: string) {
  const plan = await load(id);
  const shot = plan.shots.find((s) => s.id === shotId);
  if (!shot) throw new HttpError(404, "No such shot");
  return { card: cardText(shot), seconds: shot.seconds, requiredSeconds: Math.min(shot.seconds, shot.filmIt?.recordSeconds || shot.seconds) };
}

/** The host's verdict on a take. A take that was replaced meanwhile is ignored. */
export async function recordTake(id: string, raw: unknown): Promise<void> {
  const r = takeResultSchema.parse(raw);
  await patchShot(id, r.shotId, (s) => (s.takes.some((t) => t.libraryItemId === r.assetId) ? applyTakeResult(s, r) : s));
}

export async function markTakeFailed(id: string, shotId: string, assetId: string, error: string): Promise<void> {
  await patchShot(id, shotId, (s) => failTakeShot(s, assetId, error)).catch(() => undefined);
}

const HANDLE_S = 0.5;

/** Everything the host needs to cut the pack: library shots with half-second handles, and what is missing. */
export async function packManifest(id: string) {
  const plan = await load(id);
  const { items } = await collections();
  const ids = plan.shots.flatMap((s) => (s.source === "library" && s.libraryItemId ? [s.libraryItemId] : []));
  const kinds = new Map((await items.find({ _id: { $in: ids } }, { projection: { kind: 1 } }).toArray()).map((d) => [d._id, d.kind]));
  const clips = plan.shots
    .filter((s) => s.source === "library" && s.libraryItemId)
    .map((s) => ({ n: s.n, name: s.n === 1 ? "hook" : "shot", kind: kinds.get(s.libraryItemId!) ?? "video", assetId: s.libraryItemId!, from: Math.max(0, (s.in ?? 0) - HANDLE_S), to: (s.out ?? 0) > 0 ? (s.out ?? 0) + HANDLE_S : 0 }));
  const missing = plan.shots
    .filter((s) => s.source !== "library")
    .map((s) => `${String(s.n).padStart(2, "0")}: ${s.source === "stock" ? `stock clip, download from ${s.stock?.url}` : "film this one"} (${s.beat})`);
  return { title: plan.title, clips, missing };
}

export async function requestPack(id: string): Promise<void> {
  const plan = await load(id);
  if (plan.build !== "ready") throw new HttpError(409, "The plan isn't ready yet");
  if (plan.clipPack.status === "building") throw new HttpError(409, "Already making the clip pack");
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { clipPack: { status: "building" }, updatedAt: new Date() } });
  await enqueue("clip-pack", { planId: id });
}

export async function packDone(id: string, assetId: string): Promise<void> {
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { clipPack: { status: "ready", storageAssetId: assetId }, updatedAt: new Date() } });
}

export async function packFailed(id: string): Promise<void> {
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { clipPack: { status: "failed" }, updatedAt: new Date() } });
}

export type ShootCard = { planId: string; planTitle: string; shotId: string; n: number; seconds: number; shot: string; framing: string; recordSeconds: number; takes: number; reshoot: string | null };

/** Open Film it cards across plans, grouped by where they are filmed (cards with no directions yet are left out). */
export async function shootList(): Promise<{ where: string; cards: ShootCard[] }[]> {
  const { plans } = await collections();
  const docs = await plans.find({ status: { $in: ["planned", "filming"] }, build: "ready" }, { projection: { title: 1, shots: 1 } }).sort({ updatedAt: -1 }).toArray();
  const groups = new Map<string, { where: string; cards: ShootCard[] }>();
  for (const p of docs) {
    for (const s of p.shots) {
      const f = s.filmIt;
      if (s.source !== "film_it" || !f || f.recordSeconds <= 0) continue;
      const where = f.where.trim() || "Anywhere";
      const g = groups.get(where.toLowerCase()) ?? { where, cards: [] };
      const last = s.takes.at(-1);
      g.cards.push({ planId: p._id, planTitle: p.title, shotId: s.id, n: s.n, seconds: s.seconds, shot: f.shot || s.beat, framing: f.framing, recordSeconds: f.recordSeconds, takes: f.takes, reshoot: last?.verdict === "reshoot" ? (last.fix ?? "Reshoot") : null });
      groups.set(where.toLowerCase(), g);
    }
  }
  return [...groups.values()].sort((a, b) => b.cards.length - a.cards.length);
}

// ---------- The board and posting (phase 10) ----------

/** Moves a plan between board columns. Posted stamps the date (for format freshness); leaving it clears the date. */
export async function setStatus(id: string, status: PlanStatus): Promise<void> {
  const { plans } = await collections();
  const posted = status === "posted";
  const plan = await load(id);
  await plans.updateOne(
    { _id: id },
    { $set: { status, updatedAt: new Date(), ...(posted ? { postedAt: plan.postedAt ?? new Date() } : {}) }, ...(posted ? {} : { $unset: { postedAt: "" } }) },
  );
}

/** Links a final cut to its plan (both ways) and moves the plan on to Ready to post if it was earlier. */
export async function linkFinal(id: string, finalId: string): Promise<void> {
  const { plans, finals } = await collections();
  const plan = await load(id);
  if (!(await finals.updateOne({ _id: finalId }, { $set: { planId: id } })).matchedCount) throw new HttpError(404, "No such final cut");
  const early: PlanStatus[] = ["planned", "filming", "editing"];
  await plans.updateOne({ _id: id }, { $set: { finalId, updatedAt: new Date(), ...(early.includes(plan.status) ? { status: "ready" } : {}) } });
}

/** Marks the plan Posted and keeps the numbers you typed. */
export async function markPosted(id: string, numbers: Numbers): Promise<void> {
  await setStatus(id, "posted");
  const { plans } = await collections();
  await plans.updateOne({ _id: id }, { $set: { postedNumbers: numbers } });
}

/** The content-history writer's entry for a posted reel. You edit it, then tap Add to history. */
export async function draftHistory(id: string): Promise<HistoryDraft & { prompt: string }> {
  const plan = await load(id);
  if (plan.status !== "posted") throw new HttpError(409, "Mark it Posted first");
  const { finals } = await collections();
  const final = plan.finalId ? await finals.findOne({ _id: plan.finalId }, { projection: { selected: 1 } }) : null;
  const caption = final?.selected ? [final.selected.text, final.selected.hashtags.join(" ")].join("\n").trim() : "(not recorded)";
  const p = renderPrompt("content-history-writer", {
    contentHistory: captionVoice(await getSettings()).contentHistory,
    reel: [`Title: ${plan.title}`, `Posted: ${plan.postedAt?.toISOString().slice(0, 10)}`, `Format: ${plan.concept.format}`, `Hook: ${plan.concept.hook}`, `Caption used: ${caption}`].join("\n"),
    numbers: numbersText(plan.postedNumbers ?? {}),
  });
  const raw = await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature });
  return { ...historyDraftSchema.parse(raw), prompt: p.prompt };
}

/** Appends your (edited) entry to Settings → Content history. Only runs when you tap. */
export async function addToHistory(entry: string): Promise<void> {
  await updateSettings({ captionContentHistory: appendHistory(captionVoice(await getSettings()).contentHistory, entry) });
}
