// The storage connector's HTTP client, with fetch stubbed out.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createStorageClient, StorageError } from "../src/lib/storage/client.ts";

function stub(responses: Array<Response | Error>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, fetchStub };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("storage client", () => {
  test("sends the key and JSON, returns the body", async () => {
    const { calls, fetchStub } = stub([json(201, { mode: "single", assetId: "a", url: "u", headers: {} })]);
    const s = createStorageClient({ url: "https://storage.example/", apiKey: "rsk_x", fetch: fetchStub });
    const res = await s.createUpload({ collection: "library", filename: "a.jpg", size: 1 });
    assert.equal(res.mode, "single");
    assert.equal(calls[0].url, "https://storage.example/v1/uploads");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer rsk_x");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { collection: "library", filename: "a.jpg", size: 1 });
  });

  test("4xx errors keep the service's status and message, without retrying", async () => {
    const { calls, fetchStub } = stub([json(409, { error: { code: "conflict", message: "Upload already finished" } })]);
    const s = createStorageClient({ url: "https://s", apiKey: "k", fetch: fetchStub });
    await assert.rejects(s.signParts("a", [1]), (e: unknown) => e instanceof StorageError && e.status === 409 && e.message === "Upload already finished");
    assert.equal(calls.length, 1);
  });

  test("5xx and network errors are retried, then reported", async () => {
    const ok = stub([json(503, { error: { message: "busy" } }), new TypeError("fetch failed"), json(200, { ok: true, version: "1" })]);
    const s = createStorageClient({ url: "https://s", apiKey: "k", fetch: ok.fetchStub, retries: 2 });
    assert.deepEqual(await s.health(), { ok: true, version: "1" });
    assert.equal(ok.calls.length, 3);

    const bad = stub([new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const s2 = createStorageClient({ url: "https://s", apiKey: "k", fetch: bad.fetchStub, retries: 1 });
    await assert.rejects(s2.health(), (e: unknown) => e instanceof StorageError && e.status === 503);
  });

  test("204 responses resolve to undefined; list builds the query string", async () => {
    const { calls, fetchStub } = stub([new Response(null, { status: 204 }), json(200, { items: [], next: null })]);
    const s = createStorageClient({ url: "https://s", apiKey: "k", fetch: fetchStub });
    assert.equal(await s.deleteAsset("a b"), undefined);
    assert.equal(calls[0].url, "https://s/v1/assets/a%20b");
    await s.listAssets({ collection: "library", kind: "video", limit: 48, urls: "thumb", before: undefined });
    assert.equal(calls[1].url, "https://s/v1/assets?collection=library&kind=video&limit=48&urls=thumb");
  });
});
