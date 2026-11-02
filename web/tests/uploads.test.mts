// Browser side of uploads: the content hash and resume planning. The duplicate rules
// themselves live (and are tested) in the r2-storage service.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planResume } from "../src/lib/media/resume.ts";
import { sha256OfBlob } from "../src/lib/media/hash.ts";
import { expectedPartSize, isContentHash } from "../src/lib/media/policy.ts";

const MiB = 1024 ** 2;

describe("content hash", () => {
  test("matches the standard SHA-256 test vector", async () => {
    assert.equal(
      await sha256OfBlob(new Blob(["abc"])),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("hashing in 8 MiB chunks gives the same answer as hashing at once", async () => {
    const bytes = new Uint8Array(20 * MiB + 123);
    for (let i = 0; i < bytes.length; i += 997) bytes[i] = i % 256;
    const seen: number[] = [];
    const ours = await sha256OfBlob(new Blob([bytes]), (f) => seen.push(f));
    assert.equal(ours, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(seen.length, 3);
    assert.equal(seen.at(-1), 1);
  });

  test("empty files hash too", async () => {
    assert.equal(await sha256OfBlob(new Blob([])), createHash("sha256").digest("hex"));
  });

  test("cancelling stops the hash", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sha256OfBlob(new Blob(["x"]), undefined, controller.signal), { name: "AbortError" });
  });

  test("only lowercase 64-character hex counts", () => {
    assert.ok(isContentHash("a".repeat(64)));
    assert.ok(!isContentHash("A".repeat(64)));
    assert.ok(!isContentHash("a".repeat(63)));
  });
});

describe("resuming", () => {
  const size = 2 * 8 * MiB + 1000;
  const partSize = 8 * MiB; // what r2-storage plans for files under 80 GB
  const partCount = 3;

  test("sends only the parts R2 doesn't have", () => {
    const plan = planResume({
      size,
      partSize,
      partCount,
      uploadedParts: [
        { partNumber: 3, etag: '"c"', size: 1000 },
        { partNumber: 1, etag: '"a"', size: 8 * MiB },
      ],
    });
    assert.deepEqual(plan.missing, [2]);
    assert.deepEqual(plan.kept, [
      { partNumber: 1, etag: '"a"' },
      { partNumber: 3, etag: '"c"' },
    ]);
    assert.equal(plan.bytesDone, 8 * MiB + 1000);
  });

  test("a part of the wrong length is sent again", () => {
    const plan = planResume({ size, partSize, partCount, uploadedParts: [{ partNumber: 1, etag: '"a"', size: 5 }] });
    assert.deepEqual(plan.missing, [1, 2, 3]);
    assert.equal(plan.bytesDone, 0);
  });

  test("ignores parts outside the plan", () => {
    const plan = planResume({ size, partSize, partCount, uploadedParts: [{ partNumber: 9, etag: '"z"', size: 1 }] });
    assert.deepEqual(plan.missing, [1, 2, 3]);
  });

  test("expected part sizes cover the whole file", () => {
    let total = 0;
    for (let n = 1; n <= partCount; n++) total += expectedPartSize(size, partSize, n);
    assert.equal(total, size);
  });
});
