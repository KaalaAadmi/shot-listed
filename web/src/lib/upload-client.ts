"use client";
// Browser side of an upload: hash the file, ask the app for signed URLs, then send bytes
// straight to R2. The server matches on the hash, so the same file is never stored twice,
// and an upload that stopped part-way carries on instead of starting over.
import { sha256OfBlob } from "./media/hash.ts";
import { planResume, type UploadedPart } from "./media/resume.ts";

type Start =
  | { mode: "duplicate"; assetId: string }
  | { mode: "single"; assetId: string; url: string; headers: Record<string, string> }
  | { mode: "multipart"; assetId: string; partSize: number; partCount: number }
  | { mode: "resume"; assetId: string; partSize: number; partCount: number; uploadedParts: UploadedPart[] };

// Retrying a failed file shouldn't read it all again.
const hashes = new WeakMap<File, string>();

export type UploadOutcome = "uploaded" | "duplicate";
export type UploadResult = { outcome: UploadOutcome; assetId: string };

const PART_CONCURRENCY = 4;
const PART_RETRIES = 3;
const URL_BATCH = 20;

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** XHR rather than fetch, because fetch can't report upload progress. Resolves with the ETag. */
function put(url: string, body: Blob, headers: Record<string, string>, onBytes: (n: number) => void, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // ETag is only readable if the bucket's CORS rule exposes it (r2-storage repo: infra/r2-cors.json).
        resolve(xhr.getResponseHeader("ETag") ?? "");
      } else reject(new Error(`R2 rejected the upload (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  options: {
    purpose?: "library" | "final-cut" | "inspiration";
    /** Called while the file is being hashed, before anything is sent. */
    onChecking?: (fraction: number) => void;
  } = {},
): Promise<UploadResult> {
  let contentHash = hashes.get(file);
  if (!contentHash) {
    contentHash = await sha256OfBlob(file, options.onChecking, signal);
    hashes.set(file, contentHash);
  }
  options.onChecking?.(1);

  const start = await api<Start>("/api/media/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || undefined,
      size: file.size,
      contentHash,
      lastModified: file.lastModified,
      purpose: options.purpose,
    }),
    signal,
  });
  if (start.mode === "duplicate") {
    onProgress(1);
    return { outcome: "duplicate", assetId: start.assetId };
  }

  try {
    if (start.mode === "single") {
      await put(start.url, file, start.headers, (n) => onProgress(n / file.size), signal);
      await api(`/api/media/uploads/${start.assetId}/complete`, { method: "POST", body: "{}", signal });
    } else {
      const already = start.mode === "resume" ? planResume({ size: file.size, ...start }) : undefined;
      const parts = await uploadParts(file, start, onProgress, signal, already);
      await api(`/api/media/uploads/${start.assetId}/complete`, {
        method: "POST",
        body: JSON.stringify({ parts }),
        signal,
      });
    }
    onProgress(1);
    return { outcome: "uploaded", assetId: start.assetId };
  } catch (err) {
    // Cancelled: remove the partial upload. Any other failure: keep it, so picking the file
    // again (or Retry) resumes from the parts R2 already has.
    if (signal?.aborted) {
      await fetch(`/api/media/uploads/${start.assetId}`, { method: "DELETE" }).catch(() => undefined);
    }
    throw err;
  }
}

async function uploadParts(
  file: File,
  plan: { assetId: string; partSize: number; partCount: number },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  already?: ReturnType<typeof planResume>,
) {
  const sent = new Array<number>(plan.partCount).fill(0);
  const report = () => onProgress((sent.reduce((a, b) => a + b, 0) + (already?.bytesDone ?? 0)) / file.size);
  const etags: { partNumber: number; etag: string }[] = [...(already?.kept ?? [])];
  const queue = already ? [...already.missing] : Array.from({ length: plan.partCount }, (_, i) => i + 1);
  report();
  const urls = new Map<number, string>();

  async function urlFor(partNumber: number): Promise<string> {
    if (!urls.has(partNumber)) {
      // Sign a batch ahead; URLs last 15 minutes.
      const batch = queue.filter((n) => !urls.has(n)).slice(0, URL_BATCH);
      if (!batch.includes(partNumber)) batch.unshift(partNumber);
      const { parts } = await api<{ parts: { partNumber: number; url: string }[] }>(
        `/api/media/uploads/${plan.assetId}/parts`,
        { method: "POST", body: JSON.stringify({ partNumbers: batch }), signal },
      );
      for (const p of parts) urls.set(p.partNumber, p.url);
    }
    return urls.get(partNumber)!;
  }

  async function worker() {
    while (queue.length) {
      const partNumber = queue.shift()!;
      const startByte = (partNumber - 1) * plan.partSize;
      const blob = file.slice(startByte, Math.min(startByte + plan.partSize, file.size));
      for (let attempt = 1; ; attempt++) {
        try {
          const etag = await put(await urlFor(partNumber), blob, {}, (n) => {
            sent[partNumber - 1] = n;
            report();
          }, signal);
          if (!etag) throw new Error("R2 did not expose the ETag header; check the bucket CORS rule");
          etags.push({ partNumber, etag });
          break;
        } catch (err) {
          if (signal?.aborted || attempt >= PART_RETRIES) throw err;
          sent[partNumber - 1] = 0;
          urls.delete(partNumber); // the URL may have expired
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, Math.max(1, queue.length)) }, worker));
  return etags;
}
