import "server-only";
import { MongoClient, type Db } from "mongodb";
import { env } from "./env";
import type { AgentStatus, DuplicateDoc, FinalDoc, IdeaDoc, InspirationDoc, JobDoc, LibraryItemDoc, RunDoc, SettingsDoc, StockDoc } from "./types";
import type { PlanDoc } from "./plan-rules.ts";

// Reuse one client across hot reloads and warm serverless invocations.
const globalForMongo = globalThis as unknown as { _mongo?: Promise<MongoClient>; _indexes?: Promise<void> };

async function client(): Promise<MongoClient> {
  if (!globalForMongo._mongo) {
    // Small pool: Atlas M0 allows 500 connections and serverless functions multiply quickly.
    globalForMongo._mongo = new MongoClient(env().MONGODB_URI, { maxPoolSize: 5, ignoreUndefined: true }).connect();
  }
  return globalForMongo._mongo;
}

export async function db(): Promise<Db> {
  const database = (await client()).db(env().MONGODB_DB);
  globalForMongo._indexes ??= ensureIndexes(database).catch((err) => {
    globalForMongo._indexes = undefined;
    throw err;
  });
  await globalForMongo._indexes;
  return database;
}

export async function collections() {
  const d = await db();
  return {
    settings: d.collection<SettingsDoc>("settings"),
    agents: d.collection<AgentStatus>("agents"),
    finals: d.collection<FinalDoc>("finals"),
    items: d.collection<LibraryItemDoc>("library_items"),
    duplicates: d.collection<DuplicateDoc>("duplicates"),
    jobs: d.collection<JobDoc>("jobs"),
    inspirations: d.collection<InspirationDoc>("inspirations"),
    runs: d.collection<RunDoc>("runs"),
    ideas: d.collection<IdeaDoc>("ideas"),
    plans: d.collection<PlanDoc>("plans"),
    stock: d.collection<StockDoc>("stock"),
  };
}

// Files and their records live in the r2-storage service (its own database); ShotListed
// keeps settings, the Mac agent's check-ins and final cuts here.
async function ensureIndexes(d: Db): Promise<void> {
  const items = d.collection<LibraryItemDoc>("library_items");
  await Promise.all([
    d.collection<FinalDoc>("finals").createIndex({ createdAt: -1 }),
    d.collection<FinalDoc>("finals").createIndex({ assetId: 1 }),
    items.createIndex({ purpose: 1, createdAt: -1 }),
    items.createIndex({ "index.status": 1 }),
    items.createIndex({ kind: 1, "capture.at": 1 }), // duplicate candidates
    items.createIndex({ externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }),
    d.collection<DuplicateDoc>("duplicates").createIndex({ status: 1, mergeAfter: 1 }),
    d.collection<DuplicateDoc>("duplicates").createIndex({ keepId: 1 }),
    d.collection<DuplicateDoc>("duplicates").createIndex({ otherId: 1 }),
    d.collection<JobDoc>("jobs").createIndex({ status: 1, createdAt: 1 }),
    d.collection<InspirationDoc>("inspirations").createIndex({ shortcode: 1 }, { unique: true, partialFilterExpression: { shortcode: { $type: "string" } } }),
    d.collection<InspirationDoc>("inspirations").createIndex({ status: 1, createdAt: -1 }),
    d.collection<IdeaDoc>("ideas").createIndex({ status: 1, updatedAt: -1 }),
    d.collection<PlanDoc>("plans").createIndex({ status: 1, updatedAt: -1 }),
    d.collection<PlanDoc>("plans").createIndex({ "source.kind": 1, "source.id": 1 }),
    d.collection<PlanDoc>("plans").createIndex({ postedAt: -1 }),
    d.collection<StockDoc>("stock").createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    d.collection<RunDoc>("runs").createIndex({ subjectId: 1, createdAt: -1 }),
    d.collection<RunDoc>("runs").createIndex({ finishedAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    // Finished jobs are forgotten after 30 days.
    d.collection<JobDoc>("jobs").createIndex(
      { updatedAt: 1 },
      { expireAfterSeconds: 30 * 86400, partialFilterExpression: { status: "done" } },
    ),
  ]);
}
