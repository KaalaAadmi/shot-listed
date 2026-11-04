import "server-only";
import { randomUUID } from "node:crypto";
import { collections } from "./db";
import type { RunDoc, RunStep, RunStepStatus } from "./types";

// A run is the list of steps behind one progress bar (and later the pipeline diagram). The web app
// and the pipeline host both report into it; docs/TRD.md §3.5.

const TERMINAL: RunStepStatus[] = ["done", "skipped", "failed"];

export const stepsOf = (names: string[]): RunStep[] => names.map((name) => ({ name, status: "waiting" }));

export async function startRun(kind: RunDoc["kind"], subjectId: string, names: string[]): Promise<string> {
  const { runs } = await collections();
  const now = new Date();
  const run: RunDoc = { _id: randomUUID(), kind, subjectId, steps: stepsOf(names), createdAt: now, updatedAt: now };
  await runs.insertOne(run);
  return run._id;
}

/** Starts the steps over (a retry). */
export async function resetRun(runId: string, names: string[]): Promise<void> {
  const { runs } = await collections();
  await runs.updateOne({ _id: runId }, { $set: { steps: stepsOf(names), updatedAt: new Date() }, $unset: { finishedAt: "" } });
}

export type StepEvent = { status: RunStepStatus; summary?: string; error?: string };

/** Unknown runs or steps are ignored: an event for a run that has been forgotten is not an error. */
export async function recordStep(runId: string, name: string, e: StepEvent): Promise<void> {
  const { runs } = await collections();
  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now, "steps.$[s].status": e.status };
  if (e.status === "running") set["steps.$[s].startedAt"] = now;
  if (TERMINAL.includes(e.status)) set["steps.$[s].finishedAt"] = now;
  if (e.summary !== undefined) set["steps.$[s].summary"] = e.summary.slice(0, 300);
  if (e.error !== undefined) set["steps.$[s].error"] = e.error.slice(0, 300);
  const run = await runs.findOneAndUpdate({ _id: runId }, { $set: set }, { arrayFilters: [{ "s.name": name }], returnDocument: "after" });
  if (run && run.steps.every((s) => TERMINAL.includes(s.status))) await runs.updateOne({ _id: runId }, { $set: { finishedAt: now } });
}

export async function getRuns(ids: string[]): Promise<Map<string, RunStep[]>> {
  const { runs } = await collections();
  const docs = await runs.find({ _id: { $in: ids } }).toArray();
  return new Map(docs.map((r) => [r._id, r.steps]));
}
