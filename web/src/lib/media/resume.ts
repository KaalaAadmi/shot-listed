// Browser side of resuming: given the parts R2 already holds, work out what's left to send.
// Pure and shared, so it is unit-tested.
import { expectedPartSize } from "./policy.ts";

export type UploadedPart = { partNumber: number; etag: string; size: number };

export function planResume(input: {
  size: number;
  partSize: number;
  partCount: number;
  uploadedParts: UploadedPart[];
}): { kept: { partNumber: number; etag: string }[]; missing: number[]; bytesDone: number } {
  const kept = new Map<number, { partNumber: number; etag: string; size: number }>();
  for (const p of input.uploadedParts) {
    const inRange = Number.isInteger(p.partNumber) && p.partNumber >= 1 && p.partNumber <= input.partCount;
    // A part of the wrong length can't be ours; send it again rather than trust it.
    if (inRange && p.etag && p.size === expectedPartSize(input.size, input.partSize, p.partNumber)) {
      kept.set(p.partNumber, p);
    }
  }
  const missing: number[] = [];
  for (let n = 1; n <= input.partCount; n++) if (!kept.has(n)) missing.push(n);
  const parts = [...kept.values()].sort((a, b) => a.partNumber - b.partNumber);
  return {
    kept: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    missing,
    bytesDone: parts.reduce((sum, p) => sum + p.size, 0),
  };
}
