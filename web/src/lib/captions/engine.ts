// The two model steps behind the Captions screen:
//   1. describeVideo: the model watches your exported reel (with sound) and writes down what is in it.
//   2. writeCaptions: from that description, your Social Media Manager prompt writes the caption
//      options, hashtags, keywords, feedback and Trial advice.
// Pure apart from the injected models, so tests run it with stubs.
import { z } from "zod";
import { renderPrompt } from "../prompts.ts";
import { cleanHashtags } from "./instagram-format.ts";
import type { CaptionModel, JsonModel, UploadedVideo } from "./model.ts";

// ---------- Description ----------

export const descriptionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  hook: z.string(),
  beats: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      visual: z.string(),
      onScreenText: z.string(),
      audio: z.string(),
    }),
  ),
  spokenWords: z.string(),
  onScreenText: z.array(z.string()),
  audio: z.string(),
  setting: z.string(),
  mood: z.string(),
  callToAction: z.string(),
  durationSeconds: z.number(),
  plainDescription: z.string(),
});
export type ReelDescription = z.infer<typeof descriptionSchema>;

export async function describeVideo(
  model: CaptionModel,
  video: UploadedVideo,
  context: { notes?: string },
): Promise<ReelDescription> {
  const p = renderPrompt("describe-reel", { notes: context.notes?.trim() ?? "" });
  const raw = await model.generateJson({
    system: p.system,
    parts: [{ video }, { text: p.user }],
    schema: p.schema,
    temperature: p.temperature,
  });
  return descriptionSchema.parse(raw);
}

// ---------- Captions ----------

/** The plain-text description the caption writer reads; also what "Copy description" copies. */
export function describeForPrompt(d: ReelDescription, notes?: string): string {
  const beats = d.beats
    .map((b) => {
      const bits = [`${b.start.toFixed(1)}–${b.end.toFixed(1)}s: ${b.visual}`];
      if (b.onScreenText) bits.push(`on-screen text: "${b.onScreenText}"`);
      if (b.audio) bits.push(`audio: ${b.audio}`);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");
  return [
    d.plainDescription,
    `Length: ${Math.round(d.durationSeconds)}s`,
    `Hook (first 3 seconds): ${d.hook}`,
    `Shot by shot:\n${beats}`,
    `All on-screen text: ${d.onScreenText.length ? d.onScreenText.map((t) => `"${t}"`).join(", ") : "none"}`,
    `Spoken words: ${d.spokenWords || "none"}`,
    `Audio: ${d.audio}`,
    `Setting: ${d.setting}`,
    `Mood: ${d.mood}`,
    d.callToAction ? `Call to action in the video: ${d.callToAction}` : "",
    notes?.trim() ? `My notes: ${notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type CaptionContext = {
  /** Your Social Media Manager prompt (Settings → Caption voice). */
  systemPrompt: string;
  /** Your Content History Reference (Settings → Caption voice). */
  contentHistory: string;
  notes?: string;
  /** Extra direction when you regenerate ("shorter", "lean into the anime angle"). */
  direction?: string;
};

export type CaptionOption = {
  id: string;
  /** Tone label, e.g. "Dry & punchy". */
  angle: string;
  /** Hook, context lines and call to action, one per line. Hashtags are kept separately. */
  text: string;
  hashtags: string[];
  /** Keyword phrases this option carries. */
  keywords: string[];
  recommended: boolean;
};

export type CaptionSet = {
  options: CaptionOption[];
  recommendedWhy: string;
  keywordsWoven: { phrase: string; where: string }[];
  feedback: { rating: string; mostSimilarReel: string; lesson: string; improvement: string };
  trial: { recommended: boolean; reason: string };
  /** Which model wrote this round. */
  writtenBy: string;
};

const captionReplySchema = z.object({
  options: z
    .array(
      z.object({
        tone_label: z.string(),
        hook: z.string(),
        context: z.array(z.string()),
        cta: z.string(),
        hashtags: z.array(z.string()),
        keywords: z.array(z.string()),
      }),
    )
    .min(1),
  recommended_option: z.number(),
  recommended_reason: z.string(),
  keywords_woven: z.array(z.object({ phrase: z.string(), where: z.string() })),
  content_feedback: z.object({
    rating: z.string(),
    most_similar_reel: z.string(),
    lesson: z.string(),
    improvement: z.string(),
  }),
  trial_recommended: z.boolean(),
  trial_reason: z.string(),
});

const HASHTAG_IN_TEXT = /\s*#[\p{L}\p{N}_]+/gu;

export async function writeCaptions(
  model: JsonModel,
  description: ReelDescription,
  ctx: CaptionContext,
): Promise<CaptionSet> {
  const p = renderPrompt("write-captions", {
    voicePrompt: ctx.systemPrompt.trim(),
    contentHistory: ctx.contentHistory.trim(),
    description: describeForPrompt(description, ctx.notes),
    direction: ctx.direction?.trim() ?? "",
  });
  const raw = await model.generateJson({
    system: p.system,
    parts: [{ text: p.user }],
    schema: p.schema,
    temperature: p.temperature,
  });

  const parsed = captionReplySchema.parse(raw);
  const options = parsed.options.slice(0, 3);
  const recommended = Math.min(Math.max(Math.round(parsed.recommended_option) - 1, 0), options.length - 1);
  const stamp = Date.now().toString(36);

  return {
    options: options.map((o, i) => {
      // Models sometimes put hashtags in a text line anyway; those belong with the others.
      const strayTags: string[] = [];
      const clean = (line: string) =>
        line
          .replace(HASHTAG_IN_TEXT, (m) => {
            strayTags.push(m.trim());
            return "";
          })
          .replace(/\s+/g, " ")
          .trim();
      const lines = [o.hook, ...o.context, o.cta].map(clean).filter(Boolean);
      return {
        id: `${stamp}-${i}`,
        angle: o.tone_label.trim(),
        text: lines.join("\n"),
        hashtags: cleanHashtags([...o.hashtags, ...strayTags]),
        keywords: o.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 6),
        recommended: i === recommended,
      };
    }),
    recommendedWhy: parsed.recommended_reason.trim(),
    keywordsWoven: parsed.keywords_woven
      .map((k) => ({ phrase: k.phrase.trim(), where: k.where.trim() }))
      .filter((k) => k.phrase)
      .slice(0, 6),
    feedback: {
      rating: parsed.content_feedback.rating.trim(),
      mostSimilarReel: parsed.content_feedback.most_similar_reel.trim(),
      lesson: parsed.content_feedback.lesson.trim(),
      improvement: parsed.content_feedback.improvement.trim(),
    },
    trial: { recommended: parsed.trial_recommended, reason: parsed.trial_reason.trim() },
    writtenBy: model.label,
  };
}
