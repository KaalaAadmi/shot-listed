import "server-only";
import { env } from "../env";
import { createStorageClient, type StorageClient } from "./client.ts";

// The one place ShotListed talks to the r2-storage service. Holds STORAGE_API_KEY, so it
// must never reach the browser; the browser only ever sees presigned R2 links.
let client: StorageClient | undefined;

export function storage(): StorageClient {
  client ??= createStorageClient({ url: env().STORAGE_API_URL, apiKey: env().STORAGE_API_KEY });
  return client;
}

/** ShotListed's purposes map to storage collections; one place to change them. */
export const COLLECTION = { library: "library", "final-cut": "finals" } as const;

/** Reels shared from Instagram (or uploaded by hand). Not a Library purpose: never indexed or offered in plans. */
export const INSPIRATIONS = "inspirations";
