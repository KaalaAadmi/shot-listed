// Brief checks and the shapes the two idea prompts return (prompts/idea-coach.md, brief-maker.md "Code checks").
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { briefSchema, briefWarnings, checkBrief, coachSchema, firstTitle } from "../src/lib/idea-rules.ts";
import { shotsFromConcept } from "../src/lib/plan-rules.ts";
import type { Concept } from "../src/lib/inspiration-rules.ts";

const concept = (over: Partial<Concept> = {}): Concept => ({
  title: "t",
  format: "skit",
  hook: "h",
  lengthSeconds: 10,
  why: "w",
  beats: [
    { n: 4, seconds: 5, shows: "a", onScreenText: "", spoken: "", sound: "" },
    { n: 9, seconds: 15, shows: "b", onScreenText: "", spoken: "", sound: "" },
  ],
  onScreenText: [],
  audio: { idea: "x", searchTerms: [] },
  ...over,
});

describe("checkBrief", () => {
  test("beats are renumbered and scaled to the length", () => {
    const c = checkBrief(concept());
    assert.deepEqual(c.beats.map((b) => b.n), [1, 2]);
    assert.deepEqual(c.beats.map((b) => b.seconds), [2.5, 7.5]);
  });
  test("a pasted brief round-trips through the schema and into the same shots an inspiration would give", () => {
    const parsed = briefSchema.parse({ concept: concept(), assumptions: ["a"], questions: [] });
    const shots = shotsFromConcept(checkBrief(parsed.concept));
    assert.deepEqual(shots.map((s) => [s.n, s.seconds, s.beat]), [[1, 2.5, "a"], [2, 7.5, "b"]]);
  });
});

describe("briefWarnings", () => {
  test("one shot, or a length outside 6–30 s, is warned about but kept", () => {
    assert.equal(briefWarnings(concept({ beats: [], lengthSeconds: 40 })).length, 2);
    assert.deepEqual(briefWarnings(concept()), []);
  });
});

describe("coach", () => {
  test("readiness must be one of the three values", () => {
    assert.ok(coachSchema.safeParse({ reply: "r", readiness: "ready", workingTitle: "" }).success);
    assert.ok(!coachSchema.safeParse({ reply: "r", readiness: "done", workingTitle: "" }).success);
  });
  test("long first messages are shortened for the list", () => {
    assert.equal(firstTitle("x".repeat(100)).length, 58);
    assert.equal(firstTitle("  a\n b "), "a b");
  });
});
