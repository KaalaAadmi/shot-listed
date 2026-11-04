// Pure rules for your own ideas (prompts/idea-coach.md and brief-maker.md "Code checks").
import { z } from "zod";
import { checkConcept, conceptSchema, type Concept } from "./inspiration-rules.ts";

export const coachSchema = z.object({
  reply: z.string(),
  readiness: z.enum(["exploring", "almost", "ready"]),
  workingTitle: z.string(),
});

export const briefSchema = z.object({
  concept: conceptSchema,
  assumptions: z.array(z.string()),
  questions: z.array(z.string()),
});

/** Beats renumbered 1…n and their seconds scaled to the length; the rest is warned about, not refused. */
export const checkBrief = (c: Concept): Concept => checkConcept(c, "unknown");

export function briefWarnings(c: Concept): string[] {
  const out: string[] = [];
  if (c.beats.length < 2) out.push("Add shots before planning: a brief needs at least two.");
  if (c.lengthSeconds < 6 || c.lengthSeconds > 30) out.push("Reels in ShotListed run 6–30 seconds.");
  return out;
}

/** The title shown in the list until the coach or the brief names the idea. */
export const firstTitle = (text: string) => {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};
