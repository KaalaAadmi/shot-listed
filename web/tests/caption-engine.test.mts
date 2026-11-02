import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONTENT_HISTORY, DEFAULT_SYSTEM_PROMPT } from "../src/lib/captions/default-voice.ts";
import { describeForPrompt, describeVideo, writeCaptions, type ReelDescription } from "../src/lib/captions/engine.ts";
import type { CaptionModel, ModelPart, UploadedVideo } from "../src/lib/captions/model.ts";

const video: UploadedVideo = { name: "files/abc", uri: "https://example/files/abc", mimeType: "video/mp4" };

const description: ReelDescription = {
  title: "First Irish winter at 6 am",
  summary: "A gym-goer walks to the gym in Dublin rain.",
  hook: "Text: 'Expectation: Dublin is mild'",
  beats: [{ start: 0, end: 2, visual: "Doorway", onScreenText: "Expectation: Dublin is mild", audio: "" }],
  spokenWords: "",
  onScreenText: ["Expectation: Dublin is mild", "Reality:"],
  audio: "Upbeat original audio",
  setting: "Dublin street, gym entrance",
  mood: "Funny, relatable",
  callToAction: "",
  durationSeconds: 12,
  plainDescription: "A short comedic reel about winter workouts in Dublin.",
};

function stub(reply: unknown) {
  const calls: { system: string; parts: ModelPart[]; schema: Record<string, unknown>; temperature: number }[] = [];
  const model: CaptionModel = {
    label: "Stub model",
    async uploadVideo() {
      return video;
    },
    async generateJson(args) {
      calls.push(args);
      return reply;
    },
    async deleteVideo() {},
  };
  return { model, calls };
}

describe("describeVideo", () => {
  test("sends the video first, with the creator's notes, and validates the reply", async () => {
    const { model, calls } = stub(description);
    const out = await describeVideo(model, video, { notes: "CTA keyword: WINTER" });
    assert.equal(out.title, description.title);
    assert.deepEqual(calls[0].parts[0], { video });
    assert.match((calls[0].parts[1] as { text: string }).text, /WINTER/);
    assert.ok(calls[0].temperature <= 0.3);
  });

  test("rejects a reply missing fields", async () => {
    const { model } = stub({ title: "only a title" });
    await assert.rejects(describeVideo(model, video, {}));
  });
});

describe("writeCaptions", () => {
  const option = (n: number, extra: Partial<Record<string, unknown>> = {}) => ({
    tone_label: `Tone ${n}`,
    hook: `Hook ${n}`,
    context: [`Context ${n}a.`, `Context ${n}b.`],
    cta: `Question ${n}?`,
    hashtags: ["gym", "dublin"],
    keywords: ["expat in Ireland"],
    ...extra,
  });
  const reply = {
    options: [
      option(1, {
        hook: "Nobody warned me about Irish winters #irishwinter",
        hashtags: ["#DublinGym", "dublingym", "expatlife", "gymhumor", "indiansinireland", "extra"],
        keywords: [" gym motivation ", "expat in Ireland", ""],
      }),
      option(2),
      option(3),
      option(4),
    ],
    recommended_option: 7,
    recommended_reason: "Most sendable.",
    keywords_woven: [
      { phrase: "expat in Ireland", where: "Option 1, line 2" },
      { phrase: " ", where: "nowhere" },
    ],
    content_feedback: {
      rating: "7/10: clean setup, punchline a beat late",
      most_similar_reel: "Gym Lifestyle / Dips",
      lesson: "Land the punchline on a cut",
      improvement: "Trim the first second",
    },
    trial_recommended: true,
    trial_reason: "New format for the account",
  };

  const ctx = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    contentHistory: DEFAULT_CONTENT_HISTORY,
    notes: "Filmed at my gym",
    direction: "drier",
  };

  test("your prompt and content history are the system prompt, followed by the app's note", async () => {
    const { model, calls } = stub(reply);
    await writeCaptions(model, description, ctx);
    const system = calls[0].system;
    assert.ok(system.startsWith("== INSTAGRAM SOCIAL MEDIA MANAGER"), "your prompt comes first");
    assert.ok(system.indexOf("REEL PERFORMANCE HISTORY") > system.indexOf("SECTION 8"), "history after the prompt");
    assert.match(system, /HOW THIS CONVERSATION WORKS/);
    assert.match(system, /at most 5 hashtags/);
    const prompt = (calls[0].parts[0] as { text: string }).text;
    assert.match(prompt, /<reel_description>/);
    assert.match(prompt, /Expectation: Dublin is mild/, "on-screen text reaches the caption writer");
    assert.match(prompt, /Filmed at my gym/);
    assert.match(prompt, /drier/);
  });

  test("turns the reply into three ready-to-paste options", async () => {
    const { model } = stub(reply);
    const set = await writeCaptions(model, description, ctx);

    assert.equal(set.options.length, 3, "extra options are dropped");
    const first = set.options[0];
    assert.equal(first.angle, "Tone 1");
    assert.equal(
      first.text,
      "Nobody warned me about Irish winters\nContext 1a.\nContext 1b.\nQuestion 1?",
      "hook, context and question each on their own line; stray hashtag moved out",
    );
    assert.deepEqual(first.hashtags, ["#DublinGym", "#expatlife", "#gymhumor", "#indiansinireland", "#extra"]);
    assert.equal(first.hashtags.length, 5);
    assert.deepEqual(first.keywords, ["gym motivation", "expat in Ireland"]);
    assert.equal(set.options.filter((o) => o.recommended).length, 1);
    assert.equal(set.options[2].recommended, true, "out-of-range pick is clamped to the last option");
    assert.deepEqual(set.keywordsWoven, [{ phrase: "expat in Ireland", where: "Option 1, line 2" }]);
    assert.equal(set.feedback.mostSimilarReel, "Gym Lifestyle / Dips");
    assert.deepEqual(set.trial, { recommended: true, reason: "New format for the account" });
    assert.equal(set.writtenBy, "Stub model");
    assert.equal(new Set(set.options.map((o) => o.id)).size, 3);
  });

  test("the schema works with Claude's structured outputs: closed objects, no min/max", async () => {
    const { model, calls } = stub(reply);
    await writeCaptions(model, description, ctx);
    const banned = ["minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength"];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      for (const key of banned) assert.ok(!(key in n), `schema uses ${key}`);
      if (n.type === "object") {
        assert.equal(n.additionalProperties, false);
        assert.deepEqual([...(n.required as string[])].sort(), Object.keys(n.properties as object).sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(calls[0].schema);
  });

  test("rejects a reply missing fields", async () => {
    const { model } = stub({ options: [] });
    await assert.rejects(writeCaptions(model, description, ctx));
  });
});

describe("default caption voice", () => {
  test("is your v3.0 prompt without the chat-only lines", () => {
    assert.match(DEFAULT_SYSTEM_PROMPT, /SECTION 8 — HOW TO DELIVER CAPTION OPTIONS/);
    assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /Paste this at the start/);
    assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT + DEFAULT_CONTENT_HISTORY, /wait for my next message/);
    assert.match(DEFAULT_CONTENT_HISTORY, /11\. Dramatic Flashback/);
  });

  test("the description the caption writer reads includes every overlay and the notes", () => {
    const text = describeForPrompt(description, "CTA keyword: WINTER");
    assert.match(text, /"Expectation: Dublin is mild", "Reality:"/);
    assert.match(text, /My notes: CTA keyword: WINTER/);
    assert.match(text, /0\.0–2\.0s: Doorway/);
  });
});
