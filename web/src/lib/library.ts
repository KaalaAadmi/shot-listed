import "server-only";
import { HttpError } from "./auth";
import { collections } from "./db";
import { registerAsset, removeItem } from "./library-items";
import { isContentHash } from "./media/policy.ts";
import { COLLECTION, INSPIRATIONS, storage } from "./storage/connector.ts";
import type { StorageAsset, UploadResult } from "./storage/types.ts";
import { DEFAULT_CONTENT_HISTORY, DEFAULT_CREATOR_PROFILE, DEFAULT_SYSTEM_PROMPT } from "./captions/default-voice.ts";
import type { HashtagPlacement } from "./captions/instagram-format.ts";
import type { AgentStatus, AssetOrigin, AssetPurpose, AssetView, IngestMode, SettingsDoc } from "./types";

// Files and their records live in the r2-storage service; these functions check what Reel
// Studio cares about (who is uploading, which purpose) and pass the rest through. The
// browser, the iOS Shortcut and the Mac agent keep calling ShotListed's own routes.

/** Gemini gets the whole file in one request; a 1080p reel export is far below this. */
const MAX_FINAL_CUT_BYTES = 500 * 1024 ** 2;

// ---------- Uploads ----------

export type CreateUploadInput = {
  filename: string;
  contentType?: string;
  size: number;
  /** SHA-256 of the file (hex), computed by the uploader before it asks. */
  contentHash: string;
  lastModified?: number;
  takenAt?: string;
  externalId?: string;
  origin: AssetOrigin;
  /** "inspiration" is a reel uploaded by hand because Instagram wouldn't let the host download it. */
  purpose?: AssetPurpose | "inspiration";
};

/** Start an upload, resume one, or report a duplicate (rules live in r2-storage). */
export async function createUpload(input: CreateUploadInput): Promise<UploadResult> {
  if (!isContentHash(input.contentHash)) throw new HttpError(400, "contentHash must be a SHA-256 hex digest");
  if (input.origin === "mac-photos" && !input.externalId) {
    throw new HttpError(400, "Mac uploads must include the Photos library ID");
  }
  const purpose = input.purpose ?? "library";
  const takenAt = input.takenAt ?? (input.lastModified ? new Date(input.lastModified).toISOString() : undefined);
  return storage().createUpload({
    collection: purpose === "inspiration" ? INSPIRATIONS : COLLECTION[purpose],
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    contentHash: input.contentHash,
    externalId: input.externalId,
    takenAt,
    metadata: { origin: input.origin },
    ...(purpose !== "library" ? { kinds: ["video"], maxBytes: MAX_FINAL_CUT_BYTES } : {}),
  });
}

/** For a caller that kept the asset ID (the Mac agent): where did this upload get to? */
export function uploadState(assetId: string): Promise<UploadResult> {
  return storage().uploadState(assetId);
}

export async function signUploadParts(assetId: string, partNumbers: number[]) {
  return (await storage().signParts(assetId, partNumbers)).parts;
}

export async function completeUpload(
  assetId: string,
  parts: { partNumber: number; etag: string }[] | undefined,
): Promise<AssetView> {
  const { asset } = await storage().completeUpload(assetId, parts);
  await registerAsset(asset); // creates the library record and queues indexing
  return toView(asset, null);
}

export function abortUpload(assetId: string): Promise<void> {
  return storage().abortUpload(assetId);
}

// ---------- Library ----------

function toView(a: StorageAsset, url: string | null | undefined): AssetView {
  return {
    id: a.id,
    origin: (a.metadata.origin as AssetOrigin | undefined) ?? "phone-upload",
    filename: a.filename,
    contentType: a.contentType,
    kind: a.kind === "video" ? "video" : "photo",
    size: a.size,
    status: a.status,
    takenAt: a.takenAt,
    createdAt: a.createdAt,
    url: url ?? null,
    thumb: false,
    tags: null,
    excluded: false,
    indexStatus: "pending",
  };
}

export async function getAsset(assetId: string): Promise<AssetView> {
  const { asset } = await storage().getAsset(assetId);
  const url = asset.status === "uploaded" ? (await storage().getUrl(assetId)).url : null;
  return toView(asset, url);
}

export async function downloadUrl(assetId: string): Promise<string> {
  return (await storage().getUrl(assetId, { download: true })).url;
}

/** Removes the original and every derived file. */
export async function deleteAsset(assetId: string): Promise<void> {
  const { asset } = await storage().getAsset(assetId);
  if (asset.collection !== COLLECTION.library) throw new HttpError(404, "Not found");
  await storage().deleteAsset(assetId);
  await removeItem(assetId);
}

export async function usage() {
  const u = await storage().usage();
  return { bytes: u.bytes, photos: u.photos, videos: u.videos, freeTierBytes: u.freeTierBytes };
}

// ---------- Settings and the Mac agent ----------

const DEFAULT_SETTINGS: Omit<SettingsDoc, "updatedAt"> = {
  _id: "app",
  ingestMode: "phone-upload",
  hashtagPlacement: "caption",
  blankLineBeforeHashtags: false,
  checkDescriptionFirst: true,
};

export async function getSettings(): Promise<SettingsDoc> {
  const { settings } = await collections();
  const stored = await settings.findOne({ _id: "app" });
  return { ...DEFAULT_SETTINGS, updatedAt: new Date(0), ...stored };
}

/** Your caption voice, falling back to the v3.0 prompt and history you gave. */
export function captionVoice(s: SettingsDoc) {
  return {
    systemPrompt: s.captionSystemPrompt?.trim() ? s.captionSystemPrompt : DEFAULT_SYSTEM_PROMPT,
    contentHistory: s.captionContentHistory?.trim() ? s.captionContentHistory : DEFAULT_CONTENT_HISTORY,
    systemPromptIsDefault: !s.captionSystemPrompt?.trim(),
    contentHistoryIsDefault: !s.captionContentHistory?.trim(),
    creatorProfile: s.creatorProfile?.trim() ? s.creatorProfile : DEFAULT_CREATOR_PROFILE,
    creatorProfileIsDefault: !s.creatorProfile?.trim(),
  };
}

/** `null` clears a field, which restores its default. */
export type SettingsPatch = {
  ingestMode?: IngestMode;
  captionSystemPrompt?: string | null;
  captionContentHistory?: string | null;
  hashtagPlacement?: HashtagPlacement;
  blankLineBeforeHashtags?: boolean;
  checkDescriptionFirst?: boolean;
  creatorProfile?: string | null;
};

export async function updateSettings(patch: SettingsPatch): Promise<SettingsDoc> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) unset[k] = "";
    else set[k] = v;
  }
  const { settings } = await collections();
  await settings.updateOne(
    { _id: "app" },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { upsert: true },
  );
  return getSettings();
}

export async function recordHeartbeat(input: {
  machine: string;
  version: string;
  photosCount?: number;
  lastSyncAt?: string;
}): Promise<{ syncEnabled: boolean }> {
  const { agents } = await collections();
  await agents.updateOne(
    { _id: input.machine },
    {
      $set: {
        version: input.version,
        photosCount: input.photosCount,
        lastSyncAt: input.lastSyncAt ? new Date(input.lastSyncAt) : undefined,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true },
  );
  // The agent only syncs while you've chosen the Mac as the library source.
  return { syncEnabled: (await getSettings()).ingestMode === "mac-photos" };
}

export async function listAgents(): Promise<AgentStatus[]> {
  const { agents } = await collections();
  return agents.find().sort({ lastSeenAt: -1 }).toArray();
}
