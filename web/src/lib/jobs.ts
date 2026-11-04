import "server-only";
import { randomUUID } from "node:crypto";
import { collections } from "./db";
import type { JobDoc, JobType } from "./types";

// Jobs the pipeline host (pipeline/) runs. The host never touches Atlas; it claims jobs
// through /api/host/jobs/* (docs/TRD.md §3.5).

const LEASE_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

export async function enqueue(type: JobType, payload: Record<string, unknown>, runId?: string): Promise<string> {
  const { jobs } = await collections();
  const now = new Date();
  const job: JobDoc = { _id: randomUUID(), type, payload, status: "queued", attempts: 0, runId, createdAt: now, updatedAt: now };
  await jobs.insertOne(job);
  return job._id;
}

/** The oldest queued job, leased for 10 minutes; null when there is nothing to do. */
export async function claim(): Promise<JobDoc | null> {
  const { jobs } = await collections();
  const now = new Date();
  // A host that died mid-job leaves an expired lease: try again, up to MAX_ATTEMPTS.
  const expired = { status: "running" as const, leaseUntil: { $lt: now } };
  await jobs.updateMany({ ...expired, attempts: { $gte: MAX_ATTEMPTS } }, { $set: { status: "failed", error: "Lease expired", updatedAt: now } });
  await jobs.updateMany(expired, { $set: { status: "queued", updatedAt: now } });
  return jobs.findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

/** False when the job isn't running (finished, or the lease passed and it was handed on). */
export async function heartbeat(id: string): Promise<boolean> {
  const { jobs } = await collections();
  const now = new Date();
  const res = await jobs.updateOne({ _id: id, status: "running" }, { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now } });
  return res.matchedCount === 1;
}

export async function complete(id: string): Promise<void> {
  const { jobs } = await collections();
  await jobs.updateOne({ _id: id }, { $set: { status: "done", updatedAt: new Date() }, $unset: { leaseUntil: "" } });
}

/** Requeues until MAX_ATTEMPTS, then gives up. Returns the job as it now stands. */
export async function fail(id: string, error: string): Promise<JobDoc | null> {
  const { jobs } = await collections();
  const job = await jobs.findOne({ _id: id });
  if (!job) return null;
  const status = job.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
  await jobs.updateOne({ _id: id }, { $set: { status, error: error.slice(0, 1000), updatedAt: new Date() }, $unset: { leaseUntil: "" } });
  return { ...job, status };
}
