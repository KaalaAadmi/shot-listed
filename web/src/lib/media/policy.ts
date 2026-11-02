// The few upload rules Reel Studio still needs on its side: what the file picker offers,
// how hashes look, and how parts are sized (to check what a resumed upload already sent).
// The authoritative rules (types, sizes, part plans) live in the r2-storage service.

export type MediaKind = "photo" | "video";

export const ACCEPT_ATTRIBUTE = "image/*,video/*,.heic,.heif,.mov";

/** Duplicates are found by content: SHA-256 of the exact bytes, 64 lowercase hex characters. */
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isContentHash(value: string): boolean {
  return CONTENT_HASH_PATTERN.test(value);
}

/** Expected byte length of each part, so a resumed upload can check what R2 already holds. */
export function expectedPartSize(size: number, partSize: number, partNumber: number): number {
  const start = (partNumber - 1) * partSize;
  return Math.max(0, Math.min(partSize, size - start));
}
