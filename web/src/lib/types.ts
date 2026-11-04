import type { CaptionSet, ReelDescription } from "./captions/engine.ts";
import type { Draft, FeedbackTurn } from "./captions/feedback.ts";
import type { HashtagPlacement } from "./captions/instagram-format.ts";
import type { UploadedVideo } from "./captions/model.ts";
import type { MediaKind } from "./media/policy.ts";

/**
 * Where library items come from. Both end up in the same `library` collection of the
 * r2-storage service, so plans keep working when you switch.
 *  - phone-upload: you pick photos and videos in the web app (or the iOS Shortcut) and they go to R2.
 *  - mac-photos:   a small agent on the Mac mini reads the synced iCloud Photos library and pushes
 *                  new items itself. Phone uploads still work for Film it takes.
 */
export type IngestMode = "phone-upload" | "mac-photos";
export type AssetOrigin = "phone-upload" | "mac-photos" | "shortcut";

/** `uploaded` is where this step ends; the pipeline host later adds proxying and tagging states. */
export type AssetStatus = "uploading" | "uploaded";

/** Library items feed the planner; final cuts are your finished exports from Edits. */
export type AssetPurpose = "library" | "final-cut";

export type SettingsDoc = {
  _id: "app";
  ingestMode: IngestMode;
  /** Your Social Media Manager prompt. Unset means the v3.0 default in captions/default-voice.ts. */
  captionSystemPrompt?: string;
  /** Your Content History Reference. Unset means the default. */
  captionContentHistory?: string;
  hashtagPlacement?: HashtagPlacement;
  /** Off by default: your structure puts hashtags on line 5, right under the question. */
  blankLineBeforeHashtags?: boolean;
  /** Pause after the description so you can correct it. On unless set to false. */
  checkDescriptionFirst?: boolean;
  /** Who you are and what works, for the planner and idea coach. Unset means the default. */
  creatorProfile?: string;
  updatedAt: Date;
};

// ---------- Final cuts (Captions screen) ----------

/** The option you picked, with your edits. Hashtags are kept apart so they can go in the first comment. */
export type SelectedCaption = { captionId: string; text: string; hashtags: string[] };

export type StepName = "watch" | "describe" | "review" | "captions";
/** `needs_you`: paused for your input. `skipped`: turned off in Settings. */
export type StepStatus = "waiting" | "running" | "done" | "failed" | "needs_you" | "skipped";
export type StepState = { status: StepStatus; startedAt?: Date; finishedAt?: Date; error?: string };

export type FinalDoc = {
  _id: string;
  /** The plan this reel was made from; its hooks and intent go to the caption writer. */
  planId?: string;
  /** Null once you delete the video to free R2 space; the text stays. */
  assetId: string | null;
  title: string;
  /** True until you rename it; then the model's title no longer replaces it. */
  titleIsDefault?: boolean;
  notes: string;
  steps: Record<StepName, StepState>;
  /** The video as uploaded to Gemini; removed once it has been described. */
  modelFile?: UploadedVideo;
  description?: ReelDescription;
  /** True once you corrected the description at the review step. */
  descriptionEdited?: boolean;
  /** Prompt that wrote the description, e.g. "describe-reel@1". */
  descriptionPrompt?: string;
  /** Prompt that wrote the current caption round, e.g. "write-captions@1". */
  captionsPrompt?: string;
  captions?: CaptionSet;
  selected?: SelectedCaption;
  /** Your own caption, built from the options. */
  draft?: Draft;
  /** The feedback thread, newest last, capped at 30 turns. */
  feedback?: FeedbackTurn[];
  createdAt: Date;
  updatedAt: Date;
};

export type FinalView = {
  id: string;
  title: string;
  notes: string;
  video: { url: string | null; size: number; filename: string } | null;
  steps: Record<StepName, { status: StepStatus; error: string | null; seconds: number | null }>;
  busy: boolean;
  description: ReelDescription | null;
  captions: CaptionSet | null;
  selected: SelectedCaption | null;
  draft: Draft | null;
  feedback: FeedbackTurn[];
  createdAt: string;
};

export type AgentStatus = {
  _id: string; // machine name
  version: string;
  photosCount?: number;
  lastSyncAt?: Date;
  lastSeenAt: Date;
};

/** What the API sends to the browser. */
export type AssetView = {
  id: string;
  origin: AssetOrigin;
  filename: string;
  contentType: string;
  kind: MediaKind;
  size: number;
  status: AssetStatus;
  takenAt: string | null;
  createdAt: string;
  /** The thumbnail once the pipeline host made one, else the original. */
  url: string | null;
  /** True when `url` is a thumbnail image (also for videos). */
  thumb: boolean;
  tags: Tags | null;
  excluded: boolean;
  indexStatus: IndexStatus;
};

// ---------- Library indexing (phase 6) ----------

export type IndexStatus = "pending" | "processing" | "indexed" | "failed";

/** What the vision model says about an item (prompts/library-tagger.md), after code checks. */
export type Tags = {
  caption: string;
  setting: string;
  shotType: string;
  action: string;
  mood: string;
  peopleCount: number;
  faceVisible: boolean;
  visibleText: string;
  objects: string[];
  useFor: string[];
  quality: { sharp: boolean; wellLit: boolean; stable: boolean; note: string };
  unusable: boolean;
  unusableReason: string;
};

/** One per storage asset ShotListed cares about; `_id` is the storage asset ID. */
export type LibraryItemDoc = {
  _id: string;
  purpose: AssetPurpose;
  origin: AssetOrigin;
  kind: MediaKind;
  filename: string;
  contentType: string;
  size: number;
  takenAt: Date | null;
  durationS?: number;
  width?: number;
  height?: number;
  codec?: string;
  contentHash: string | null;
  externalId?: string;
  capture?: { at: Date; subsec?: number; tz?: string; camera?: string };
  /** 64-bit perceptual hashes as hex: one for a photo, three for a video. */
  phash?: string[];
  /** Set while a Same match waits out its 7-day undo window. */
  hiddenAsDuplicateOf?: string;
  variants: { proxy: boolean; thumb: boolean };
  index: { status: IndexStatus; error?: string; at: Date };
  tags?: Tags;
  embedding?: number[];
  /** Never offered in plans. */
  excluded: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DuplicateVerdict = "same" | "possible" | "final-cut";
export type DuplicateStatus = "waiting" | "open" | "merged" | "kept-both" | "undone";

/** One per pair of items; `_id` is `<older>:<newer>`. Rules in docs/TRD.md §4.1. */
export type DuplicateDoc = {
  _id: string;
  keepId: string;
  otherId: string;
  verdict: DuplicateVerdict;
  evidence: { secondsApart: number; subsecMatch: boolean | null; hashDistance: number; durationDiff: number | null; sameBytes: boolean };
  betterFile: "keep" | "other";
  status: DuplicateStatus;
  mergeAfter?: Date;
  createdAt: Date;
  resolvedAt?: Date;
};

// ---------- Jobs for the pipeline host ----------

export type JobType =
  | "index-asset"
  | "ingest-inspiration"
  | "analyse-inspiration"
  | "plan"
  | "plan-edit"
  | "clip-pack"
  | "check-take"
  | "sync-collection";

export type JobDoc = {
  _id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  /** Up to MAX_ATTEMPTS. */
  attempts: number;
  leaseUntil?: Date;
  runId?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

// ---------- Shared reels (phase 7) ----------

import type { Concept, InspirationAnalysis, Viability } from "./inspiration-rules.ts";

export type InspirationStatus = "queued" | "downloading" | "analysing" | "scored" | "planned" | "skipped" | "failed";

/** What yt-dlp found; counts are null when Instagram didn't say. */
export type InspirationMeta = {
  creator: string;
  caption: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  durationS: number | null;
  audio: { title: string; isOriginal: boolean | null };
};

export type InspirationDoc = {
  _id: string;
  url: string;
  /** Missing for reels you uploaded as a file. Unique when present. */
  shortcode?: string;
  source: "share" | "sync" | "upload";
  note: string;
  status: InspirationStatus;
  storageAssetId?: string;
  meta?: InspirationMeta;
  analysis?: InspirationAnalysis;
  /** `analysis.concept`, after the code checks; the plan reads this. */
  concept?: Concept;
  viability?: Viability;
  /** Prompts that produced the analysis and the score, e.g. "inspiration-analysis@1". */
  analysisPrompt?: string;
  viabilityPrompt?: string;
  /** You pressed Make anyway on a Skip. */
  overridden?: boolean;
  planId?: string;
  runId: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RunStepStatus = "waiting" | "running" | "done" | "needs_you" | "skipped" | "failed";
export type RunStep = { name: string; status: RunStepStatus; startedAt?: Date; finishedAt?: Date; summary?: string; error?: string };

/** Step events behind the live progress bars; `subjectId` is the inspiration, idea or plan. */
export type RunDoc = {
  _id: string;
  kind: "inspiration" | "idea" | "plan" | "final";
  subjectId: string;
  steps: RunStep[];
  createdAt: Date;
  updatedAt: Date;
  /** Set when the last step ends; the TTL index forgets the run 30 days later. */
  finishedAt?: Date;
};

export type IdeaDoc = {
  _id: string;
  title: string;
  status: "chatting" | "briefed" | "planned" | "dropped";
  messages: { at: string; role: "you" | "model"; text: string }[];
  /** What the model remembers of the first `folded` messages. */
  summary?: string;
  folded?: number;
  readiness?: "exploring" | "almost" | "ready";
  brief?: Concept;
  briefSource?: "chat" | "pasted";
  /** Things the brief maker filled in, and things it needs answered (dismiss or fix, then Make the plan). */
  assumptions?: string[];
  questions?: string[];
  viability?: Viability;
  /** Prompts used, e.g. { coach: "idea-coach@1", brief: "brief-maker@1", viability: "viability-judge@1" }. */
  prompts?: Record<string, string>;
  planId?: string;
  createdAt: Date;
  updatedAt: Date;
};

/** What the Inbox shows. */
export type InspirationView = {
  id: string;
  url: string;
  source: InspirationDoc["source"];
  note: string;
  status: InspirationStatus;
  title: string;
  creator: string | null;
  steps: { name: string; status: RunStepStatus; summary: string | null }[];
  viability: Viability | null;
  concept: Concept | null;
  hasVideo: boolean;
  overridden: boolean;
  planId: string | null;
  error: string | null;
  createdAt: string;
};

/** A cached Pexels search; `_id` is `query|orientation`. A TTL index forgets it after 30 days. */
export type StockDoc = {
  _id: string;
  results: { pexelsId: number; url: string; credit: string; duration: number; width: number; height: number }[];
  fetchedAt: Date;
};
