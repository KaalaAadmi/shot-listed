// Feedback on a caption you put together yourself (TRD §3.3a, prompts/caption-feedback.md).
// One model call; the numbers the code can measure override the model's claims.
// No server or browser imports: shared by the API, the UI and the tests.
import { z } from "zod";
import type { CaptionOption } from "./engine.ts";
import { cleanHashtags, formatForInstagram, MAX_CAPTION_CHARS, MAX_HASHTAGS } from "./instagram-format.ts";
import type { JsonModel } from "./model.ts";
import { renderPrompt } from "../prompts.ts";

export type Draft = { lines: string[]; hashtags: string[] };

const check = z.object({ ok: z.boolean(), note: z.string() });
const replySchema = z.object({
  verdict: z.enum(["strong", "good", "needs_work"]),
  score: z.number(),
  summary: z.string(),
  checks: z.object({
    hook: check,
    structure: check,
    lineLength: check,
    keywords: check,
    hashtags: check,
    limits: check,
  }),
  suggestions: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["replace_line", "add_line", "remove_line", "replace_hashtags"]),
      line: z.number(),
      text: z.string(),
      why: z.string(),
    }),
  ),
  answer: z.string(),
});
export type FeedbackReply = z.infer<typeof replySchema>;
export type Suggestion = FeedbackReply["suggestions"][number];
/** One question and answer, with the draft as it was when you asked. */
export type FeedbackTurn = {
  question: string;
  draft: Draft;
  reply: FeedbackReply;
  /** Prompt that wrote the reply, e.g. "caption-feedback@1". */
  prompt?: string;
};

const tagLine = (tags: string[]) => tags.join(" ");

function measure(d: Draft) {
  const tags = cleanHashtags(d.hashtags, 30);
  const { charCount } = formatForInstagram(d.lines.join("\n"), tags, "caption");
  return { chars: charCount, tags: tags.length, empty: d.lines.filter((l) => !l.trim()).length };
}

export type FeedbackInput = {
  systemPrompt: string;
  contentHistory: string;
  /** describeForPrompt() of the (corrected) description. */
  description: string;
  options: CaptionOption[];
  draft: Draft;
  question: string;
  /** Earlier turns, oldest first; only the last 10 are sent. */
  thread: FeedbackTurn[];
};

export async function askFeedback(model: JsonModel, input: FeedbackInput): Promise<FeedbackReply> {
  const m = measure(input.draft);
  const options = input.options
    .map((o, i) => `Option ${i + 1} (${o.angle}):\n${o.text}\nHashtags: ${tagLine(o.hashtags)}`)
    .join("\n\n");
  const thread = input.thread
    .slice(-10)
    .map((t) => `You asked: ${t.question || "(no question)"}\nScore was ${t.reply.score}; main point: ${t.reply.summary}`)
    .join("\n\n");

  const p = renderPrompt("caption-feedback", {
    voicePrompt: input.systemPrompt.trim(),
    contentHistory: input.contentHistory.trim(),
    description: input.description,
    options,
    draft: `${input.draft.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\nHashtags: ${tagLine(input.draft.hashtags)}`,
    codeChecks: `Characters: ${m.chars} of ${MAX_CAPTION_CHARS}\nHashtags: ${m.tags} of ${MAX_HASHTAGS}\nEmpty lines: ${m.empty}`,
    thread,
    question: input.question,
  });
  const raw = await model.generateJson({
    system: p.system,
    parts: [{ text: p.user }],
    schema: p.schema,
    temperature: p.temperature,
  });
  return finishReply(replySchema.parse(raw), input.draft);
}

/** Where the code can measure, it wins over the model. */
export function finishReply(reply: FeedbackReply, draft: Draft): FeedbackReply {
  const m = measure(draft);
  const lines = draft.lines.length;
  const dropped: string[] = [];
  const suggestions: Suggestion[] = [];
  for (const s of reply.suggestions) {
    if (s.kind === "replace_hashtags") {
      const tags = cleanHashtags(s.text.split(/[\s,]+/), 30);
      if (tags.length === 0 || tags.length > MAX_HASHTAGS) {
        dropped.push(`A hashtag suggestion with ${tags.length} tags was dropped (the limit is ${MAX_HASHTAGS}).`);
        continue;
      }
      suggestions.push({ ...s, line: 0, text: tagLine(tags) });
    } else if (s.kind === "add_line" ? s.line >= 0 && s.line <= lines : s.line >= 1 && s.line <= lines) {
      suggestions.push(s);
    }
    if (suggestions.length === 4) break;
  }
  const limitsOk = m.chars <= MAX_CAPTION_CHARS && m.tags <= MAX_HASHTAGS;
  return {
    ...reply,
    score: Math.min(10, Math.max(1, Math.round(reply.score))),
    summary: [reply.summary.trim(), ...dropped].join(" "),
    checks: {
      ...reply.checks,
      limits: {
        ok: limitsOk,
        note: `${m.chars} of ${MAX_CAPTION_CHARS.toLocaleString("en-US")} characters, ${m.tags} of ${MAX_HASHTAGS} hashtags.`,
      },
    },
    suggestions,
  };
}

/** The draft after taking one suggestion. Nothing is applied without a tap. */
export function applySuggestion(d: Draft, s: Suggestion): Draft {
  const lines = [...d.lines];
  switch (s.kind) {
    case "replace_line":
      lines[s.line - 1] = s.text;
      break;
    case "add_line":
      lines.splice(s.line, 0, s.text);
      break;
    case "remove_line":
      lines.splice(s.line - 1, 1);
      break;
    case "replace_hashtags":
      return { lines, hashtags: cleanHashtags(s.text.split(/[\s,]+/), 30) };
  }
  return { lines, hashtags: d.hashtags };
}
