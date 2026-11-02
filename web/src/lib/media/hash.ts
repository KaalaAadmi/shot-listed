// SHA-256 of a file, read 8 MiB at a time so a multi-GB video never sits in memory at once.
// WebCrypto can only hash a whole buffer, so this uses hash-wasm's incremental hasher.
// Works in the browser and in Node (tests).
import { createSHA256 } from "hash-wasm";

const CHUNK_BYTES = 8 * 1024 ** 2;

// One file at a time: hashing is CPU-bound, and three at once would only make each slower.
let queue: Promise<unknown> = Promise.resolve();

export function sha256OfBlob(
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const run = queue.then(() => hash(blob, onProgress, signal));
  queue = run.catch(() => undefined);
  return run;
}

async function hash(blob: Blob, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const hasher = await createSHA256();
  hasher.init();
  for (let start = 0; start < blob.size; start += CHUNK_BYTES) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const chunk = new Uint8Array(await blob.slice(start, start + CHUNK_BYTES).arrayBuffer());
    hasher.update(chunk);
    onProgress?.(Math.min(1, (start + chunk.byteLength) / blob.size));
  }
  if (blob.size === 0) onProgress?.(1);
  return hasher.digest("hex");
}
