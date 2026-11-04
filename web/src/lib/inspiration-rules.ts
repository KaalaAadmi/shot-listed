// Pure rules for shared reels (docs/TRD.md §4, prompts/inspiration-analysis.md and viability-judge.md).
// No server imports, so the tests run them directly.
import { z } from "zod";

// ---------- Links ----------

/** The reel's shortcode from an Instagram link, or null for anything else (so only Instagram is ever fetched). */
export function shortcodeOf(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (!/^(www\.)?(instagram\.com|instagr\.am)$/.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
  const code = at >= 0 ? parts[at + 1] : undefined;
  return code && /^[A-Za-z0-9_-]{5,40}$/.test(code) ? code : null;
}

export const reelUrl = (shortcode: string) => `https://www.instagram.com/reel/${shortcode}/`;

// ---------- The concept: the plan's input, from a shared reel or your own brief ----------

export const conceptSchema = z.object({
  title: z.string(),
  format: z.string(),
  hook: z.string(),
  lengthSeconds: z.number(),
  why: z.string(),
  beats: z.array(
    z.object({
      n: z.number(),
      seconds: z.number(),
      shows: z.string(),
      onScreenText: z.string(),
      spoken: z.string(),
      sound: z.string(),
    }),
  ),
  onScreenText: z.array(z.string()),
  audio: z.object({ idea: z.string(), searchTerms: z.array(z.string()) }),
});
export type Concept = z.infer<typeof conceptSchema>;

export const analysisSchema = z.object({
  concept: conceptSchema,
  hookType: z.string(),
  punchlineAtSeconds: z.number(),
  emotion: z.string(),
  cta: z.string(),
  whyItWorks: z.array(z.string()),
  needs: z.object({
    people: z.number(),
    props: z.array(z.string()),
    locations: z.array(z.string()),
    skills: z.array(z.string()),
  }),
  audioIsOriginal: z.string(),
});
export type InspirationAnalysis = z.infer<typeof analysisSchema>;

/** Code checks on what the model returned: beats numbered 1…n, seconds adding up, a vague sound filled from Instagram. */
export function checkConcept(c: Concept, audioTitle: string): Concept {
  let beats = c.beats.map((b, i) => ({ ...b, n: i + 1 }));
  const sum = beats.reduce((a, b) => a + b.seconds, 0);
  if (sum > 0 && c.lengthSeconds > 0 && Math.abs(sum - c.lengthSeconds) > 1) {
    const k = c.lengthSeconds / sum;
    beats = beats.map((b) => ({ ...b, seconds: Math.round(b.seconds * k * 10) / 10 }));
  }
  const idea = c.audio.idea.trim();
  const vague = !idea || /^(unknown|unclear|none|n\/a)\b/i.test(idea);
  const named = audioTitle.trim() && audioTitle.trim().toLowerCase() !== "unknown";
  return { ...c, beats, audio: vague && named ? { ...c.audio, idea: audioTitle.trim() } : c.audio };
}

/** The concept as readable text, for the judge (and later the planner). */
export function conceptText(c: Concept): string {
  const beats = c.beats.map((b) => {
    const bits = [`${b.n}. (${b.seconds}s) ${b.shows}`];
    if (b.onScreenText) bits.push(`text: "${b.onScreenText}"`);
    if (b.spoken) bits.push(`says: "${b.spoken}"`);
    if (b.sound) bits.push(`sound: ${b.sound}`);
    return bits.join(" | ");
  });
  return [
    `Title: ${c.title}`,
    `Format: ${c.format}`,
    `Length: ${c.lengthSeconds}s`,
    `Hook: ${c.hook}`,
    `Why it works: ${c.why}`,
    "Beats:",
    ...beats,
    `Sound: ${c.audio.idea}`,
  ].join("\n");
}

// ---------- Viability ----------

const clamp10 = (n: number) => Math.min(10, Math.max(0, n));

export const judgeSchema = z.object({
  nicheFit: z.object({ score: z.number(), why: z.string() }),
  effort: z.object({ score: z.number(), why: z.string() }),
  formatFreshness: z.object({ score: z.number(), why: z.string(), similarRecentPost: z.string() }),
  sharePotential: z.object({ score: z.number(), why: z.string() }),
  twist: z.string(),
  reason: z.string(),
});
export type Judged = z.infer<typeof judgeSchema>;

export type Verdict = "make" | "twist" | "skip";

export type Viability = {
  /** 0–100. */
  score: number;
  verdict: Verdict;
  reason: string;
  twist: string;
  factors: { nicheFit: number; clipCoverage: number; effort: number; formatFreshness: number; sharePotential: number };
  why: { nicheFit: string; effort: string; formatFreshness: string; sharePotential: string };
  similarRecentPost: string;
  vetoedBy?: "formatFreshness";
};

/** "Beat 1: 3 likely clips · Beat 2: none", the cheap estimate the judge is shown. */
export function coverageText(counts: number[]): string {
  return counts
    .map((n, i) => `Beat ${i + 1}: ${n === 0 ? "none" : `${n} likely clip${n === 1 ? "" : "s"}`}`)
    .join(" · ");
}

/** The model scores four factors; the score and the verdict come from here, so they stay predictable. */
export function viabilityOf(j: Judged, clipCounts: number[], source: "other" | "own"): Viability {
  const nicheFit = clamp10(j.nicheFit.score);
  const effort = clamp10(j.effort.score);
  const formatFreshness = clamp10(j.formatFreshness.score);
  const sharePotential = clamp10(j.sharePotential.score);
  const clipCoverage = clipCounts.length ? (clipCounts.filter((n) => n > 0).length / clipCounts.length) * 10 : 0;
  const score = Math.round(nicheFit * 3 + clipCoverage * 2 + effort * 1.5 + formatFreshness * 1.5 + sharePotential * 2);

  const vetoedBy = source === "other" && formatFreshness <= 2 ? ("formatFreshness" as const) : undefined;
  let verdict: Verdict;
  if (source === "other" && (score < 45 || vetoedBy)) verdict = "skip";
  else if (score >= 70 && !j.twist.trim()) verdict = "make";
  else verdict = "twist"; // your own idea is never skipped
  return {
    score,
    verdict,
    reason: j.reason,
    twist: j.twist,
    factors: { nicheFit, clipCoverage, effort, formatFreshness, sharePotential },
    why: {
      nicheFit: j.nicheFit.why,
      effort: j.effort.why,
      formatFreshness: j.formatFreshness.why,
      sharePotential: j.sharePotential.why,
    },
    similarRecentPost: j.formatFreshness.similarRecentPost,
    ...(vetoedBy ? { vetoedBy } : {}),
  };
}
