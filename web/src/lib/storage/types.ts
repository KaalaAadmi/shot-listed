// Request and response shapes of the r2-storage API (v1). The source of truth is that
// repo's openapi.yaml; keep these in step when the API changes.

export type StorageKind = "photo" | "video" | "file";

export type StorageAsset = {
  id: string;
  collection: string;
  filename: string;
  contentType: string;
  kind: StorageKind;
  size: number;
  contentHash: string | null;
  externalId: string | null;
  takenAt: string | null;
  status: "uploading" | "uploaded";
  hasOriginal: boolean;
  metadata: Record<string, unknown>;
  variants: { name: string; contentType: string; size: number; status: "uploading" | "uploaded" }[];
  createdAt: string;
  updatedAt: string;
  /** Only on list results asked for with `urls=`. */
  url?: string | null;
};

export type UploadedPart = { partNumber: number; etag: string; size: number };

export type UploadResult =
  | { mode: "duplicate"; assetId: string; adopted: boolean }
  | { mode: "single"; assetId: string; url: string; headers: Record<string, string> }
  | { mode: "multipart"; assetId: string; partSize: number; partCount: number }
  | { mode: "resume"; assetId: string; partSize: number; partCount: number; uploadedParts: UploadedPart[] };

export type CreateUploadRequest = {
  collection: string;
  filename: string;
  contentType?: string;
  size: number;
  contentHash?: string;
  externalId?: string;
  takenAt?: string;
  metadata?: Record<string, unknown>;
  maxBytes?: number;
  kinds?: StorageKind[];
};

export type StorageUsage = {
  bytes: number;
  objects: number;
  photos: number;
  videos: number;
  files: number;
  byCollection: { collection: string; bytes: number; objects: number }[];
  freeTierBytes: number;
};

export type SignedUrl = { url: string; expiresAt: string };
