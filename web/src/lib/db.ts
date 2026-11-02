import "server-only";
import { MongoClient, type Db } from "mongodb";
import { env } from "./env";
import type { AgentStatus, FinalDoc, SettingsDoc } from "./types";

// Reuse one client across hot reloads and warm serverless invocations.
const globalForMongo = globalThis as unknown as { _mongo?: Promise<MongoClient>; _indexes?: Promise<void> };

async function client(): Promise<MongoClient> {
  if (!globalForMongo._mongo) {
    // Small pool: Atlas M0 allows 500 connections and serverless functions multiply quickly.
    globalForMongo._mongo = new MongoClient(env().MONGODB_URI, { maxPoolSize: 5 }).connect();
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
  };
}

// Files and their records live in the r2-storage service (its own database); Reel Studio
// keeps settings, the Mac agent's check-ins and final cuts here.
async function ensureIndexes(d: Db): Promise<void> {
  await Promise.all([
    d.collection<FinalDoc>("finals").createIndex({ createdAt: -1 }),
    d.collection<FinalDoc>("finals").createIndex({ assetId: 1 }),
  ]);
}
