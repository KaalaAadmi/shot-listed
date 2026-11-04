import "server-only";
import { randomUUID } from "node:crypto";
import { HttpError } from "./auth.ts";
import { claudeModel } from "./captions/claude.ts";
import { cleanHashtags } from "./captions/instagram-format.ts";
import {
  describeForPrompt,
  describeVideo,
  writeCaptions,
  type CaptionContext,
  type CaptionSet,
  type ReelDescription,
} from "./captions/engine.ts";
import { askFeedback, type Draft } from "./captions/feedback.ts";
import { geminiModel } from "./captions/gemini.ts";
import type { CaptionModel, JsonModel } from "./captions/model.ts";
import { collections } from "./db.ts";
import { planDirection } from "./plan-rules.ts";
import { promptStamp } from "./prompts.ts";
import { env } from "./env.ts";
import { captionVoice, getSettings } from "./library.ts";
import { removeItem } from "./library-items.ts";
import { StorageError } from "./storage/client.ts";
import { COLLECTION, storage } from "./storage/connector.ts";
import type { StorageAsset } from "./storage/types.ts";
import type { FinalDoc, FinalView, SelectedCaption, StepName, StepState } from "./types.ts";

/** A step still "running" after this long was cut off by the function timeout. */
const STALE_RUN_MS = 6 * 60 * 1000;
const STEP_ORDER: StepName[] = ["watch", "describe", "review", "captions"];
const FEEDBACK_TURNS = 30;

/** Watches the video. Only Gemini can, so its key is required for the first two steps. */
export function videoModel(): CaptionModel {
  const { GEMINI_API_KEY, GEMINI_MODEL } = env();
  if (!GEMINI_API_KEY) throw new HttpError(503, "Add GEMINI_API_KEY in Vercel to turn on captions");
  return geminiModel(GEMINI_API_KEY, GEMINI_MODEL);
}

/** Looks at thumbnails and does cheap jobs (grading clips, folding long chats). */
export function visionModel(): JsonModel {
  const { GEMINI_API_KEY, VISION_MODEL } = env();
  if (!GEMINI_API_KEY) throw new HttpError(503, "Add GEMINI_API_KEY in Vercel to grade clips");
  return geminiModel(GEMINI_API_KEY, VISION_MODEL);
}

/** Writes the captions: Claude when its key is set (your prompt was written for it), else Gemini. */
export function captionWriter(): JsonModel {
  const { ANTHROPIC_API_KEY, CLAUDE_MODEL } = env();
  return ANTHROPIC_API_KEY ? claudeModel(ANTHROPIC_API_KEY, CLAUDE_MODEL) : videoModel();
}

/**
 * Rounds written before the v3.0 prompt had one shared hashtag list and no feedback.
 * Fill in the gaps so the screen can show them the same way.
 */
function normaliseCaptions(c: CaptionSet | undefined): CaptionSet | null {
  if (!c) return null;
  const legacy = c as CaptionSet & { hashtags?: string[] };
  return {
    ...c,
    options: c.options.map((o) => ({ ...o, hashtags: o.hashtags ?? legacy.hashtags ?? [] })),
    keywordsWoven: c.keywordsWoven ?? [],
    feedback: c.feedback ?? { rating: "", mostSimilarReel: "", lesson: "", improvement: "" },
    trial: c.trial ?? { recommended: false, reason: "" },
    writtenBy: c.writtenBy ?? "Gemini",
  };
}

function normaliseSelected(doc: FinalDoc, captions: CaptionSet | null): SelectedCaption | null {
  if (!doc.selected) return null;
  const option = captions?.options.find((o) => o.id === doc.selected!.captionId);
  return { ...doc.selected, hashtags: doc.selected.hashtags ?? option?.hashtags ?? [] };
}

const waiting = (): StepState => ({ status: "waiting" });

function isStale(step: StepState): boolean {
  return step.status === "running" && !!step.startedAt && Date.now() - step.startedAt.getTime() > STALE_RUN_MS;
}

function isBusy(doc: FinalDoc): boolean {
  return STEP_ORDER.some((s) => doc.steps[s].status === "running" && !isStale(doc.steps[s]));
}

// ---------- Reads ----------

/** The final cut's file record, or null if it was deleted (here or in storage). */
async function finalCutAsset(assetId: string | null): Promise<StorageAsset | null> {
  if (!assetId) return null;
  try {
    return (await storage().getAsset(assetId)).asset;
  } catch (err) {
    if (err instanceof StorageError && err.status === 404) return null;
    throw err;
  }
}

async function toView(doc: FinalDoc): Promise<FinalView> {
  const captions = normaliseCaptions(doc.captions);
  const asset = await finalCutAsset(doc.assetId);
  const steps = Object.fromEntries(
    STEP_ORDER.map((name) => {
      const s = doc.steps[name];
      const stale = isStale(s);
      const seconds =
        s.startedAt && s.finishedAt ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 1000) : null;
      return [
        name,
        {
          status: stale ? "failed" : s.status,
          error: stale ? "Timed out. Retry to pick up from here." : (s.error ?? null),
          seconds,
        },
      ];
    }),
  ) as FinalView["steps"];

  return {
    id: doc._id,
    title: doc.title,
    notes: doc.notes,
    video: asset
      ? {
          url: asset.status === "uploaded" ? (await storage().getUrl(asset.id)).url : null,
          size: asset.size,
          filename: asset.filename,
        }
      : null,
    steps,
    busy: isBusy(doc),
    description: doc.description ?? null,
    captions,
    selected: normaliseSelected(doc, captions),
    draft: doc.draft ?? null,
    feedback: doc.feedback ?? [],
    createdAt: doc.createdAt.toISOString(),
  };
}

async function load(id: string): Promise<FinalDoc> {
  const { finals } = await collections();
  const doc = await finals.findOne({ _id: id });
  if (!doc) throw new HttpError(404, "Not found");
  // Final cuts made before the review step existed have no state for it.
  doc.steps.review ??= doc.steps.captions.status === "done" ? { status: "skipped" } : waiting();
  return doc;
}

export async function getFinal(id: string): Promise<FinalView> {
  return toView(await load(id));
}

export async function listFinals(): Promise<FinalView[]> {
  const { finals } = await collections();
  const docs = await finals.find().sort({ createdAt: -1 }).limit(50).toArray();
  return Promise.all(docs.map(toView));
}

// ---------- Create and run ----------

/** Called after the browser finishes uploading the exported reel to R2. */
export async function createFinal(assetId: string, notes: string): Promise<{ id: string; existing: boolean }> {
  const { finals } = await collections();
  const asset = await finalCutAsset(assetId);
  if (!asset || asset.status !== "uploaded") throw new HttpError(404, "Upload not found");
  if (asset.collection !== COLLECTION["final-cut"]) throw new HttpError(400, "That upload is a library item, not a final cut");

  // Picking the same export twice reopens the existing captions instead of paying again.
  const existing = await finals.findOne({ assetId });
  if (existing) return { id: existing._id, existing: true };

  const now = new Date();
  const doc: FinalDoc = {
    _id: randomUUID(),
    assetId,
    title: asset.filename.replace(/\.[^.]+$/, ""),
    titleIsDefault: true,
    notes: notes.trim(),
    steps: { watch: waiting(), describe: waiting(), review: waiting(), captions: waiting() },
    createdAt: now,
    updatedAt: now,
  };
  await finals.insertOne(doc);
  return { id: doc._id, existing: false };
}

async function setStep(id: string, step: StepName, state: StepState, extra: Partial<FinalDoc> = {}) {
  const { finals } = await collections();
  await finals.updateOne({ _id: id }, { $set: { [`steps.${step}`]: state, ...extra, updatedAt: new Date() } });
}

/**
 * Marks the steps from `from` onwards as waiting and refuses to start a second run
 * while one is going. Returns the first step to run; the caller runs it in `after()`.
 * `description` is your corrected version from the review step.
 */
export async function prepareRun(id: string, from?: StepName, description?: ReelDescription): Promise<StepName> {
  const doc = await load(id);
  if (isBusy(doc)) throw new HttpError(409, "Already working on this one");

  // Default: resume at the first step that isn't finished. Review isn't run, it's answered.
  const finished = (s: StepName) => doc.steps[s].status === "done" || doc.steps[s].status === "skipped";
  let start = from ?? STEP_ORDER.find((s) => !finished(s)) ?? "captions";
  if (start === "review") start = "captions";
  if (start === "describe" && !doc.modelFile) start = "watch"; // the uploaded copy was cleaned up
  if (start !== "captions" && !doc.assetId) {
    throw new HttpError(409, "The video was deleted, so it can't be watched again. Captions can still be regenerated.");
  }
  if (start === "captions" && !doc.description) start = doc.modelFile ? "describe" : "watch";

  const reset = STEP_ORDER.slice(STEP_ORDER.indexOf(start));
  const { finals } = await collections();
  await finals.updateOne(
    { _id: id },
    {
      $set: {
        ...Object.fromEntries(reset.map((s) => [`steps.${s}`, waiting()])),
        // Going on from the review step closes it; a description fixed there is kept.
        ...(start === "captions" && doc.steps.review.status === "needs_you"
          ? { "steps.review": { status: "done", finishedAt: new Date() } }
          : {}),
        ...(description && start === "captions" ? { description, descriptionEdited: true } : {}),
        // Mark the first step running now, so a double tap can't start two runs.
        [`steps.${start}`]: { status: "running", startedAt: new Date() },
        updatedAt: new Date(),
      },
    },
  );
  return start;
}

/** Runs the pipeline from `start` to the end. Never throws: failures are written to the step. */
export async function runFrom(id: string, start: StepName, direction?: string): Promise<void> {
  let current: StepName = start;
  try {
    let doc = await load(id);

    if (current === "watch") {
      const startedAt = new Date();
      await setStep(id, "watch", { status: "running", startedAt });
      const asset = await finalCutAsset(doc.assetId);
      if (!asset) throw new Error("The video is no longer in storage");
      const file = await storage().download(asset.id);
      const blob = new Blob([await file.arrayBuffer()], { type: asset.contentType });
      const modelFile = await videoModel().uploadVideo(blob, asset.contentType, doc.title);
      await setStep(id, "watch", { status: "done", startedAt, finishedAt: new Date() }, { modelFile });
      doc = await load(id);
      current = "describe";
    }

    if (current === "describe") {
      const startedAt = new Date();
      await setStep(id, "describe", { status: "running", startedAt });
      if (!doc.modelFile) throw new Error("The video hasn't been sent to the model yet");
      const watcher = videoModel();
      const description = await describeVideo(watcher, doc.modelFile, { notes: doc.notes });
      await watcher.deleteVideo(doc.modelFile);
      const { finals } = await collections();
      await finals.updateOne(
        { _id: id },
        {
          $set: {
            "steps.describe": { status: "done", startedAt, finishedAt: new Date() },
            description,
            descriptionEdited: false,
            descriptionPrompt: promptStamp("describe-reel"),
            // Keep your own title if you renamed it; otherwise the model's beats the file name.
            ...(doc.titleIsDefault && description.title.trim() ? { title: description.title.trim() } : {}),
            updatedAt: new Date(),
          },
          $unset: { modelFile: "" },
        },
      );
      // Pause here so you can fix what the model misread, unless you turned that off.
      if ((await getSettings()).checkDescriptionFirst !== false) {
        await setStep(id, "review", { status: "needs_you" });
        return;
      }
      await setStep(id, "review", { status: "skipped" });
      doc = await load(id);
      current = "captions";
    }

    const startedAt = new Date();
    await setStep(id, "captions", { status: "running", startedAt });
    if (!doc.description) throw new Error("No description to write captions from");
    const voice = captionVoice(await getSettings());
    const plan = doc.planId ? await (await collections()).plans.findOne({ _id: doc.planId }) : null;
    const ctx: CaptionContext = {
      systemPrompt: voice.systemPrompt,
      contentHistory: voice.contentHistory,
      notes: doc.notes,
      direction: [plan && planDirection(plan), direction].filter(Boolean).join("\n\n") || undefined,
    };
    const captions = await writeCaptions(captionWriter(), doc.description, ctx);
    const recommended = captions.options.find((o) => o.recommended) ?? captions.options[0];
    const selected: SelectedCaption = {
      captionId: recommended.id,
      text: recommended.text,
      hashtags: recommended.hashtags,
    };
    await setStep(
      id,
      "captions",
      { status: "done", startedAt, finishedAt: new Date() },
      // A new round replaces your selection with the new recommendation.
      { captions, selected, captionsPrompt: promptStamp("write-captions") },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Final ${id} failed at ${current}:`, err);
    const doc = await load(id).catch(() => null);
    await setStep(id, current, {
      status: "failed",
      startedAt: doc?.steps[current].startedAt,
      finishedAt: new Date(),
      error: message.slice(0, 300),
    }).catch(() => undefined);
  }
}

// ---------- Edits ----------

export async function updateFinal(
  id: string,
  patch: { title?: string; notes?: string; selected?: SelectedCaption; draft?: Draft },
): Promise<FinalView> {
  const doc = await load(id);
  // "draft" is your own caption built from the options.
  if (
    patch.selected &&
    patch.selected.captionId !== "draft" &&
    !doc.captions?.options.some((o) => o.id === patch.selected!.captionId)
  ) {
    throw new HttpError(400, "Unknown caption option");
  }
  if (patch.draft) patch = { ...patch, draft: { ...patch.draft, hashtags: cleanHashtags(patch.draft.hashtags, 30) } };
  if (patch.selected) {
    // Clean and dedupe, but don't silently drop extras: the editor warns when there are more than 5.
    patch = { ...patch, selected: { ...patch.selected, hashtags: cleanHashtags(patch.selected.hashtags, 30) } };
  }
  const { finals } = await collections();
  const titleChange = patch.title !== undefined ? { titleIsDefault: false } : {};
  await finals.updateOne({ _id: id }, { $set: { ...patch, ...titleChange, updatedAt: new Date() } });
  return getFinal(id);
}

/** Starts a fresh feedback thread. */
export async function clearFeedback(id: string): Promise<FinalView> {
  await load(id);
  const { finals } = await collections();
  await finals.updateOne({ _id: id }, { $set: { feedback: [], updatedAt: new Date() } });
  return getFinal(id);
}

/** One feedback call on your draft. Needs captions to exist; the thread is kept on the final cut. */
export async function giveFeedback(id: string, draft: Draft, question: string): Promise<FinalView> {
  const doc = await load(id);
  const captions = normaliseCaptions(doc.captions);
  if (!captions || !doc.description) throw new HttpError(409, "Write the captions first");
  const voice = captionVoice(await getSettings());
  const reply = await askFeedback(captionWriter(), {
    systemPrompt: voice.systemPrompt,
    contentHistory: voice.contentHistory,
    description: describeForPrompt(doc.description, doc.notes),
    options: captions.options,
    draft,
    question,
    thread: doc.feedback ?? [],
  });
  const { finals } = await collections();
  await finals.updateOne(
    { _id: id },
    {
      $set: {
        feedback: [...(doc.feedback ?? []), { question, draft, reply, prompt: promptStamp("caption-feedback") }].slice(-FEEDBACK_TURNS),
        draft,
        updatedAt: new Date(),
      },
    },
  );
  return getFinal(id);
}

/** Frees the R2 space but keeps the description and captions. */
export async function deleteFinalVideo(id: string): Promise<void> {
  const doc = await load(id);
  if (isBusy(doc)) throw new HttpError(409, "Wait until it finishes");
  if (!doc.assetId) return;
  const { finals } = await collections();
  await storage()
    .deleteAsset(doc.assetId)
    .catch((err: unknown) => {
      if (!(err instanceof StorageError && err.status === 404)) throw err; // already gone is fine
    });
  await removeItem(doc.assetId);
  await finals.updateOne({ _id: id }, { $set: { assetId: null, updatedAt: new Date() } });
}

export async function deleteFinal(id: string): Promise<void> {
  await deleteFinalVideo(id);
  const { finals } = await collections();
  await finals.deleteOne({ _id: id });
}
