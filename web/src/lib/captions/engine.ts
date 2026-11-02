// The two model steps behind the Captions screen:
//   1. describeVideo: the model watches your exported reel (with sound) and writes down what is in it.
//   2. writeCaptions: from that description, your Social Media Manager prompt writes the caption
//      options, hashtags, keywords, feedback and Trial advice.
// Pure apart from the injected models, so tests run it with stubs.
import { z } from "zod";
import { cleanHashtags, MAX_HASHTAGS } from "./instagram-format.ts";
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

const str = (description: string) => ({ type: "string", description });

const DESCRIPTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: str("Short working title for the reel, under 8 words"),
    summary: str("Two or three sentences: what the reel shows and its point"),
    hook: str("Exactly what happens and is said or shown in the first 3 seconds"),
    beats: {
      type: "array",
      description: "Each distinct shot or moment, in order",
      items: {
        type: "object",
        properties: {
          start: { type: "number", description: "Seconds from the start" },
          end: { type: "number" },
          visual: str("What is on screen"),
          onScreenText: str("Text overlay shown during this beat, verbatim, or empty"),
          audio: str("Voiceover, dialogue or notable sound in this beat, or empty"),
        },
        required: ["start", "end", "visual", "onScreenText", "audio"],
      },
    },
    spokenWords: str("Full transcript of any speech or voiceover, or empty"),
    onScreenText: { type: "array", items: { type: "string" }, description: "Every text overlay, verbatim, in order" },
    audio: str("Music or sound: genre, energy, whether it is a trending-style track or original audio"),
    setting: str("Where it was filmed, as specifically as can be seen"),
    mood: str("The feeling the reel is going for"),
    callToAction: str("Any call to action in the video itself, or empty"),
    durationSeconds: { type: "number" },
    plainDescription: str(
      "One paragraph describing the reel for someone who cannot see it, specific enough to write a caption from",
    ),
  },
  required: [
    "title",
    "summary",
    "hook",
    "beats",
    "spokenWords",
    "onScreenText",
    "audio",
    "setting",
    "mood",
    "callToAction",
    "durationSeconds",
    "plainDescription",
  ],
};

const DESCRIBE_SYSTEM = [
  "You watch short vertical videos (Instagram Reels) and describe them precisely.",
  "Report only what is actually seen and heard. Quote on-screen text and speech verbatim.",
  "Do not guess identities of people. Do not invent locations you cannot see.",
].join(" ");

export async function describeVideo(
  model: CaptionModel,
  video: UploadedVideo,
  context: { notes?: string },
): Promise<ReelDescription> {
  const raw = await model.generateJson({
    system: DESCRIBE_SYSTEM,
    parts: [
      { video },
      {
        text: [
          "Describe this reel.",
          context.notes ? `The creator added this context: ${context.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    schema: DESCRIPTION_JSON_SCHEMA,
    temperature: 0.2,
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

// Written to work with both Claude's and Gemini's structured output: every object closed,
// every field required, and no min/max keywords (Claude rejects them; counts are checked in code).
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });

const CAPTIONS_JSON_SCHEMA = obj({
  options: {
    type: "array",
    description: "Exactly 3 caption options, each with a clearly different tone",
    items: obj({
      tone_label: str("Short tone label, e.g. 'Dry & punchy'"),
      hook: str("Line 1: the hook. One line, no line breaks"),
      context: strings("Lines 2-3: one or two natural sentences, one per item, carrying the keywords"),
      cta: str("Line 4: a question that invites a reply or a tag"),
      hashtags: strings(`Line 5: 3 to ${MAX_HASHTAGS} mid-size hashtags (100k-2M posts), without the # sign`),
      keywords: strings("The keyword phrases this option carries, exactly as they appear in it"),
    }),
  },
  recommended_option: { type: "integer", description: "1, 2 or 3: the option you would post" },
  recommended_reason: str("One or two sentences on why"),
  keywords_woven: {
    type: "array",
    description: "The 4 to 6 keyword phrases, and where each sits",
    items: obj({ phrase: str("The keyword phrase"), where: str("Which option and line carry it, e.g. 'Option 2, line 2'") }),
  },
  content_feedback: obj({
    rating: str("Honest rating with a short reason, e.g. '6/10: the punchline lands too late'"),
    most_similar_reel: str("The past reel from the content history it is most like"),
    lesson: str("What to learn from that reel"),
    improvement: str("One specific thing to improve"),
  }),
  trial_recommended: { type: "boolean", description: "Whether to post this with Instagram's Trial feature" },
  trial_reason: str("One line"),
});

/**
 * Appended after your prompt. Your Section 8 asks for a text layout; the app shows the same
 * content as cards and copies it for Instagram, so this maps each piece to a field, and adds
 * the one thing your prompt doesn't ask for: which option the model would post.
 */
const ENGINE_CONTRACT = `---

HOW THIS CONVERSATION WORKS
You are running inside Reel Studio, my own app. The reel is already edited. You can't watch it: a video model watched it with sound and wrote the description in my message, including every on-screen text overlay and any speech. Treat that description as what my audience sees and hears.

Deliver everything Section 3 asks for, in the JSON fields instead of the Section 8 text layout:
- options: exactly 3, each following the Section 4 structure: hook, context (1–2 sentences, one per item), cta, hashtags (3–5, without the # sign). Instagram now allows at most ${MAX_HASHTAGS} hashtags per post, so never more. No line breaks or hashtags inside the text fields.
- recommended_option and recommended_reason: which option you would post, and why.
- keywords_woven: the 4–6 phrases and where each one sits.
- content_feedback: honest, per Section 1. If the reel is weak, say so.
- trial_recommended and trial_reason: per Section 7.`;

const HASHTAG_IN_TEXT = /\s*#[\p{L}\p{N}_]+/gu;

export async function writeCaptions(
  model: JsonModel,
  description: ReelDescription,
  ctx: CaptionContext,
): Promise<CaptionSet> {
  const system = [ctx.systemPrompt.trim(), ctx.contentHistory.trim(), ENGINE_CONTRACT].filter(Boolean).join("\n\n");
  const raw = await model.generateJson({
    system,
    parts: [
      {
        text: [
          "Here is my finished reel, described by a model that watched it with sound:",
          `<reel_description>\n${describeForPrompt(description, ctx.notes)}\n</reel_description>`,
          ctx.direction?.trim() ? `Direction for this round: ${ctx.direction.trim()}` : "",
          "Give me the full set of deliverables for this reel.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: CAPTIONS_JSON_SCHEMA,
    temperature: 0.9,
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
