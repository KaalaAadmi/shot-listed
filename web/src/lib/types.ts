import type { CaptionSet, ReelDescription } from "./captions/engine.ts";
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
  updatedAt: Date;
};

// ---------- Final cuts (Captions screen) ----------

/** The option you picked, with your edits. Hashtags are kept apart so they can go in the first comment. */
export type SelectedCaption = { captionId: string; text: string; hashtags: string[] };

export type StepName = "watch" | "describe" | "captions";
export type StepStatus = "waiting" | "running" | "done" | "failed";
export type StepState = { status: StepStatus; startedAt?: Date; finishedAt?: Date; error?: string };

export type FinalDoc = {
  _id: string;
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
  captions?: CaptionSet;
  selected?: SelectedCaption;
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
  url: string | null;
};
