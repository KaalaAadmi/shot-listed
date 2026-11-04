import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONTENT_HISTORY, DEFAULT_SYSTEM_PROMPT } from "../src/lib/captions/default-voice.ts";
import type { CaptionOption } from "../src/lib/captions/engine.ts";
import {
  applySuggestion,
  askFeedback,
  finishReply,
  type FeedbackReply,
  type Suggestion,
} from "../src/lib/captions/feedback.ts";
import type { JsonModel, ModelPart } from "../src/lib/captions/model.ts";

const ok = { ok: true, note: "fine" };
const reply = (extra: Partial<FeedbackReply> = {}): FeedbackReply => ({
  verdict: "good",
  score: 7,
  summary: "Solid.",
  checks: { hook: ok, structure: ok, lineLength: ok, keywords: ok, hashtags: ok, limits: { ok: false, note: "model guess" } },
  suggestions: [],
  answer: "",
  ...extra,
});
const sug = (kind: Suggestion["kind"], line: number, text: string): Suggestion => ({ id: "s", kind, line, text, why: "because" });

const options: CaptionOption[] = [
  { id: "a", angle: "Dry", text: "Hook\nContext\nQuestion?", hashtags: ["#gym"], keywords: [], recommended: true },
];
const draft = { lines: ["Hook", "Context", "Question?"], hashtags: ["#gym", "#dublin"] };

function stub(r: unknown) {
  const calls: { system: string; parts: ModelPart[]; schema: Record<string, unknown> }[] = [];
  const model: JsonModel = {
    label: "Stub",
    async generateJson(args) {
      calls.push(args);
      return r;
    },
  };
  return { model, calls };
}

describe("askFeedback", () => {
  const input = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    contentHistory: DEFAULT_CONTENT_HISTORY,
    description: "A reel about winter.",
    options,
    draft,
    question: "Is line 1 hooky?",
    thread: [],
  };

  test("sends your prompt, the numbered draft, the code checks and the question", async () => {
    const { model, calls } = stub(reply());
    await askFeedback(model, input);
    assert.ok(calls[0].system.startsWith("== INSTAGRAM SOCIAL MEDIA MANAGER"));
    const text = (calls[0].parts[0] as { text: string }).text;
    assert.match(text, /1\. Hook\n2\. Context\n3\. Question\?\nHashtags: #gym #dublin/);
    assert.match(text, /Hashtags: 2 of 5/);
    assert.match(text, /Is line 1 hooky\?/);
  });

  test("the schema is closed with every field required (Claude and Gemini)", async () => {
    const { model, calls } = stub(reply());
    await askFeedback(model, input);
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      for (const k of ["minItems", "maxItems", "minimum", "maximum"]) assert.ok(!(k in o), k);
      if (o.type === "object") {
        assert.equal(o.additionalProperties, false);
        assert.deepEqual([...(o.required as string[])].sort(), Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(calls[0].schema);
  });

  test("rejects a reply missing fields", async () => {
    await assert.rejects(askFeedback(stub({ verdict: "good" }).model, input));
  });
});

describe("finishReply", () => {
  test("code wins on the numbers: score clamped, limits recomputed", () => {
    const out = finishReply(reply({ score: 14 }), draft);
    assert.equal(out.score, 10);
    assert.equal(out.checks.limits.ok, true);
    assert.match(out.checks.limits.note, /2 of 5 hashtags/);
    assert.equal(finishReply(reply({ score: 0 }), draft).score, 1);
  });

  test("flags more than 5 hashtags in the draft as over the limit", () => {
    const many = { lines: ["x"], hashtags: ["a", "b", "c", "d", "e", "f", "g"].map((t) => `#${t}`) };
    assert.equal(finishReply(reply(), many).checks.limits.ok, false);
  });

  test("drops bad suggestions and keeps at most 4", () => {
    const out = finishReply(
      reply({
        suggestions: [
          sug("replace_line", 9, "out of range"),
          sug("replace_hashtags", 0, "a b c d e f"),
          sug("add_line", 0, "top"),
          sug("replace_line", 1, "one"),
          sug("replace_line", 2, "two"),
          sug("replace_line", 3, "three"),
          sug("remove_line", 3, ""),
        ],
      }),
      draft,
    );
    assert.deepEqual(
      out.suggestions.map((s) => s.text),
      ["top", "one", "two", "three"],
    );
    assert.match(out.summary, /hashtag suggestion with 6 tags was dropped/);
  });

  test("cleans suggested hashtags", () => {
    const out = finishReply(reply({ suggestions: [sug("replace_hashtags", 3, "#gym, dublin  #gym")] }), draft);
    assert.equal(out.suggestions[0].text, "#gym #dublin");
    assert.equal(out.suggestions[0].line, 0);
  });
});

describe("applySuggestion", () => {
  test("edits the draft", () => {
    assert.deepEqual(applySuggestion(draft, sug("replace_line", 1, "New")).lines, ["New", "Context", "Question?"]);
    assert.deepEqual(applySuggestion(draft, sug("add_line", 0, "Top")).lines, ["Top", "Hook", "Context", "Question?"]);
    assert.deepEqual(applySuggestion(draft, sug("add_line", 3, "End")).lines, ["Hook", "Context", "Question?", "End"]);
    assert.deepEqual(applySuggestion(draft, sug("remove_line", 2, "")).lines, ["Hook", "Question?"]);
    assert.deepEqual(applySuggestion(draft, sug("replace_hashtags", 0, "#a #b")).hashtags, ["#a", "#b"]);
  });

  test("does not change the original", () => {
    applySuggestion(draft, sug("remove_line", 1, ""));
    assert.equal(draft.lines.length, 3);
  });
});
