// Checks Reel Studio can reach and use the storage service with its own key.
//   npm run check:storage            (reads .env.local)
// Uploads a 1 KB file through the connector's client, uploads it again (expects
// "duplicate"), reads it back, then deletes it.
import { createHash, randomBytes } from "node:crypto";
import { createStorageClient } from "../src/lib/storage/client.ts";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // variables may already be set
}

const url = process.env.STORAGE_API_URL;
const apiKey = process.env.STORAGE_API_KEY;
if (!url || !apiKey) {
  console.error("Set STORAGE_API_URL and STORAGE_API_KEY (in .env.local or the environment).");
  process.exit(1);
}

const storage = createStorageClient({ url, apiKey });
const ok = (msg: string) => console.log(`✓ ${msg}`);

try {
  const health = await storage.health();
  ok(`storage service is up (v${health.version}) at ${url}`);

  const body = randomBytes(1024);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const req = { collection: "check-storage", filename: "check.jpg", contentType: "image/jpeg", size: body.length, contentHash };
  const start = await storage.createUpload(req);
  if (start.mode !== "single") throw new Error(`expected a single upload, got ${start.mode}`);
  const put = await fetch(start.url, { method: "PUT", body, headers: start.headers });
  if (!put.ok) throw new Error(`R2 refused the upload (${put.status}); check the bucket and its CORS rule`);
  await storage.completeUpload(start.assetId);
  ok("uploaded 1 KB straight to R2 and completed it");

  const again = await storage.createUpload(req);
  if (again.mode !== "duplicate" || again.assetId !== start.assetId) throw new Error(`expected duplicate, got ${again.mode}`);
  ok("the same file again is a duplicate");

  const back = new Uint8Array(await (await storage.download(start.assetId)).arrayBuffer());
  if (createHash("sha256").update(back).digest("hex") !== contentHash) throw new Error("the file read back differs");
  ok("read it back through a signed link");

  await storage.deleteAsset(start.assetId);
  ok("deleted it");

  const used = await storage.usage();
  ok(`usage: ${(used.bytes / 1024 ** 2).toFixed(1)} MB of ${(used.freeTierBytes / 1024 ** 3).toFixed(0)} GB`);
  console.log("\nReel Studio ↔ storage: all good.");
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
