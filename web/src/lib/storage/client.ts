// HTTP client for the r2-storage service. No Next.js or server-only imports, so the
// check-storage script and tests can use it directly; the app uses `connector.ts`.
import type {
  CreateUploadRequest,
  SignedUrl,
  StorageAsset,
  StorageKind,
  StorageUsage,
  UploadResult,
} from "./types.ts";

/** A storage error carries the service's status and message, so routes can pass them on. */
export class StorageError extends Error {
  // Plain fields, not parameter properties: Node's type stripping (tests, scripts) can't run those.
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type StorageClientOptions = {
  url: string;
  apiKey: string;
  /** Per attempt. */
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createStorageClient(opts: StorageClientOptions) {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 2;

  // Every call is safe to repeat: uploads dedupe by hash, completing is idempotent, and
  // deleting twice just reports 404 the second time.
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = err; // network error or timeout: try again
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (res.ok) return json as T;
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      lastError = new StorageError(res.status, err?.code ?? "error", err?.message ?? `Storage returned ${res.status}`);
      if (!RETRYABLE.has(res.status)) throw lastError;
    }
    if (lastError instanceof StorageError) throw lastError;
    throw new StorageError(503, "unreachable", "The storage service didn't respond");
  }

  const enc = encodeURIComponent;

  return {
    health: () => call<{ ok: boolean; version: string }>("GET", "/v1/health"),

    createUpload: (req: CreateUploadRequest) => call<UploadResult>("POST", "/v1/uploads", req),
    uploadState: (id: string) => call<UploadResult>("GET", `/v1/uploads/${enc(id)}`),
    signParts: (id: string, partNumbers: number[]) =>
      call<{ parts: { partNumber: number; url: string }[] }>("POST", `/v1/uploads/${enc(id)}/parts`, { partNumbers }),
    completeUpload: (id: string, parts?: { partNumber: number; etag: string }[]) =>
      call<{ asset: StorageAsset }>("POST", `/v1/uploads/${enc(id)}/complete`, { parts }),
    abortUpload: (id: string) => call<void>("DELETE", `/v1/uploads/${enc(id)}`),

    listAssets: (q: {
      collection?: string;
      kind?: StorageKind;
      before?: string;
      limit?: number;
      urls?: string;
    }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
      return call<{ items: StorageAsset[]; next: string | null }>("GET", `/v1/assets?${params}`);
    },
    getAsset: (id: string) => call<{ asset: StorageAsset }>("GET", `/v1/assets/${enc(id)}`),
    getUrl: (id: string, o: { variant?: string; download?: boolean; expiresIn?: number } = {}) =>
      call<SignedUrl>("POST", `/v1/assets/${enc(id)}/url`, o),
    getUrls: (items: { id: string; variant?: string }[], expiresIn?: number) =>
      call<{ urls: { id: string; url: string | null }[]; expiresAt: string }>("POST", "/v1/assets/urls", { items, expiresIn }),
    updateAsset: (id: string, patch: Record<string, unknown>) =>
      call<{ asset: StorageAsset }>("PATCH", `/v1/assets/${enc(id)}`, patch),
    deleteAsset: (id: string) => call<void>("DELETE", `/v1/assets/${enc(id)}`),
    mergeAssets: (id: string, from: string, keepOriginal: "this" | "from") =>
      call<{ asset: StorageAsset }>("POST", `/v1/assets/${enc(id)}/merge`, { from, keepOriginal }),

    createVariant: (id: string, v: { name: string; contentType: string; size: number }) =>
      call<{ url: string; headers: Record<string, string>; expiresAt: string }>("POST", `/v1/assets/${enc(id)}/variants`, v),
    completeVariant: (id: string, name: string) =>
      call<{ asset: StorageAsset }>("POST", `/v1/assets/${enc(id)}/variants/${enc(name)}/complete`),

    usage: () => call<StorageUsage>("GET", "/v1/usage"),

    /** Download the original (or a variant) through a signed link. */
    async download(id: string, variant?: string): Promise<Blob> {
      const { url } = await this.getUrl(id, { variant });
      const res = await doFetch(url);
      if (!res.ok) throw new StorageError(502, "download_failed", `Could not read the file from storage (${res.status})`);
      return res.blob();
    },
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
