import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { HttpError } from "./auth";
import { foldChat, threadText } from "./chat";
import { collections } from "./db";
import { captionWriter } from "./finals";
import { briefSchema, briefWarnings, checkBrief, coachSchema, firstTitle } from "./idea-rules.ts";
import { conceptSchema, type Concept } from "./inspiration-rules.ts";
import { judge } from "./inspirations";
import { captionVoice, getSettings } from "./library";
import { createPlan, recentFormats } from "./plans";
import { renderPrompt } from "./prompts.ts";
import type { IdeaDoc } from "./types";

// Your own ideas: a chat with a coach (idea-coach), a brief made from it or pasted (brief-maker), a viability
// score for information only, then the same plan as for a shared reel.

async function load(id: string): Promise<IdeaDoc> {
  const { ideas } = await collections();
  const idea = await ideas.findOne({ _id: id });
  if (!idea) throw new HttpError(404, "Not found");
  return idea;
}

export type IdeaView = Omit<IdeaDoc, "createdAt" | "updatedAt"> & { warnings: string[]; updatedAt: string };

function view(idea: IdeaDoc): IdeaView {
  const { createdAt, updatedAt, ...rest } = idea;
  void createdAt;
  return { ...rest, warnings: rest.brief ? briefWarnings(rest.brief) : [], updatedAt: updatedAt.toISOString() };
}

export async function getIdea(id: string): Promise<IdeaView> {
  return view(await load(id));
}

export type IdeaSummary = { id: string; title: string; status: IdeaDoc["status"]; planId: string | null; updatedAt: string };

export async function listIdeas(): Promise<IdeaSummary[]> {
  const { ideas } = await collections();
  const docs = await ideas.find({ status: { $ne: "dropped" } }, { projection: { messages: 0 } }).sort({ updatedAt: -1 }).limit(100).toArray();
  return docs.map((d) => ({ id: d._id, title: d.title, status: d.status, planId: d.planId ?? null, updatedAt: d.updatedAt.toISOString() }));
}

/** A new idea from your first message; the coach answers it. */
export async function createIdea(text: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const { ideas } = await collections();
  await ideas.insertOne({ _id: id, title: firstTitle(text), status: "chatting", messages: [], createdAt: now, updatedAt: now });
  await sendMessage(id, text);
  return id;
}

export async function sendMessage(id: string, text: string): Promise<void> {
  const idea = await load(id);
  if (idea.status === "planned") throw new HttpError(409, "This idea already has a plan");
  const voice = captionVoice(await getSettings());
  const p = renderPrompt("idea-coach", {
    creatorProfile: voice.creatorProfile,
    contentHistory: voice.contentHistory,
    recentFormats: await recentFormats(),
    thread: threadText(idea.messages, idea.folded ?? 0, idea.summary),
    message: text,
  });
  const out = coachSchema.parse(await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature }));
  const at = new Date().toISOString();
  const { ideas } = await collections();
  await ideas.updateOne(
    { _id: id },
    {
      $set: {
        readiness: out.readiness,
        // The brief names the idea once there is one; until then the coach's working title does.
        ...(out.workingTitle.trim() && !idea.brief ? { title: out.workingTitle.trim().slice(0, 80) } : {}),
        "prompts.coach": p.prompt,
        updatedAt: new Date(),
      },
      $push: { messages: { $each: [{ at, role: "you" as const, text }, { at, role: "model" as const, text: out.reply }] } },
    },
  );
  after(async () => {
    const fresh = await load(id).catch(() => null);
    const folded = fresh && (await foldChat("idea chat", fresh.messages, fresh.folded ?? 0, fresh.summary).catch(() => null));
    if (folded) await ideas.updateOne({ _id: id }, { $set: folded });
  });
}

// ---------- The brief ----------

async function brief(mode: "chat" | "pasted", material: string) {
  const p = renderPrompt("brief-maker", { mode, material });
  const out = briefSchema.parse(await captionWriter().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature }));
  return { concept: checkBrief(out.concept), assumptions: out.assumptions, questions: out.questions, prompt: p.prompt };
}

/** Viability is for information and never blocks; a failure just leaves it out. */
async function score(id: string, concept: Concept): Promise<void> {
  try {
    const { viability, prompt } = await judge(concept, "own");
    await (await collections()).ideas.updateOne({ _id: id }, { $set: { viability, "prompts.viability": prompt } });
  } catch (err) {
    console.error(`Scoring idea ${id} failed:`, err);
  }
}

async function saveBrief(id: string, b: Awaited<ReturnType<typeof brief>>, source: "chat" | "pasted"): Promise<void> {
  const { ideas } = await collections();
  await ideas.updateOne(
    { _id: id },
    {
      $set: { brief: b.concept, briefSource: source, assumptions: b.assumptions, questions: b.questions, status: "briefed", title: b.concept.title.slice(0, 80), "prompts.brief": b.prompt, updatedAt: new Date() },
      $unset: { viability: "" },
    },
  );
  after(() => score(id, b.concept));
}

/** Make the brief from the chat. */
export async function makeBrief(id: string): Promise<void> {
  const idea = await load(id);
  if (idea.status === "planned") throw new HttpError(409, "This idea already has a plan");
  if (!idea.messages.length) throw new HttpError(409, "Talk the idea through first");
  await saveBrief(id, await brief("chat", threadText(idea.messages, idea.folded ?? 0, idea.summary)), "chat");
}

/** Paste a brief from anywhere: a new idea that starts at the brief. */
export async function pasteBrief(text: string): Promise<string> {
  const b = await brief("pasted", text);
  const id = randomUUID();
  const now = new Date();
  const { ideas } = await collections();
  await ideas.insertOne({ _id: id, title: b.concept.title.slice(0, 80), status: "chatting", messages: [], createdAt: now, updatedAt: now });
  await saveBrief(id, b, "pasted");
  return id;
}

/** Your edits to the brief. `questions` is the list that remains after you answered or dismissed some. */
export async function editBrief(id: string, raw: unknown, questions: string[]): Promise<void> {
  const idea = await load(id);
  if (idea.status === "planned") throw new HttpError(409, "This idea already has a plan");
  const concept = checkBrief(conceptSchema.parse(raw));
  const { ideas } = await collections();
  await ideas.updateOne(
    { _id: id },
    { $set: { brief: concept, questions: questions.filter((q) => idea.questions?.includes(q)), title: concept.title.slice(0, 80), status: "briefed", updatedAt: new Date() }, $unset: { viability: "" } },
  );
  after(() => score(id, concept));
}

export async function makePlan(id: string): Promise<string> {
  const idea = await load(id);
  if (!idea.brief) throw new HttpError(409, "Make the brief first");
  if (idea.questions?.length) throw new HttpError(409, "Answer or dismiss the questions on the brief first");
  if (briefWarnings(idea.brief).some((w) => w.startsWith("Add shots"))) throw new HttpError(409, "Add shots to the brief first");
  return createPlan("idea", id);
}

export async function dropIdea(id: string): Promise<void> {
  await load(id);
  await (await collections()).ideas.updateOne({ _id: id }, { $set: { status: "dropped", updatedAt: new Date() } });
}
