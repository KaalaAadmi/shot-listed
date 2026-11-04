// Share links, concept checks and the viability score (prompts/viability-judge.md "Code checks").
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  checkConcept,
  coverageText,
  shortcodeOf,
  viabilityOf,
  type Concept,
  type Judged,
} from "../src/lib/inspiration-rules.ts";

describe("shortcodeOf", () => {
  test("reads reel, post and profile-prefixed links", () => {
    assert.equal(shortcodeOf("https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=abc"), "C1a2B3c4D5e");
    assert.equal(shortcodeOf("https://instagram.com/p/Abcde_-12/"), "Abcde_-12");
    assert.equal(shortcodeOf("https://www.instagram.com/someone/reel/XyZ12345/"), "XyZ12345");
  });
  test("refuses other sites and non-reel pages", () => {
    assert.equal(shortcodeOf("https://evil.example/reel/C1a2B3c4D5e/"), null);
    assert.equal(shortcodeOf("https://www.instagram.com/someone/"), null);
    assert.equal(shortcodeOf("not a link"), null);
  });
});

const concept = (over: Partial<Concept> = {}): Concept => ({
  title: "t",
  format: "skit",
  hook: "h",
  lengthSeconds: 10,
  why: "w",
  beats: [
    { n: 7, seconds: 5, shows: "a", onScreenText: "", spoken: "", sound: "" },
    { n: 9, seconds: 15, shows: "b", onScreenText: "", spoken: "", sound: "" },
  ],
  onScreenText: [],
  audio: { idea: "", searchTerms: [] },
  ...over,
});

describe("checkConcept", () => {
  test("renumbers beats and scales seconds to the length", () => {
    const c = checkConcept(concept(), "unknown");
    assert.deepEqual(c.beats.map((b) => b.n), [1, 2]);
    assert.deepEqual(c.beats.map((b) => b.seconds), [2.5, 7.5]);
  });
  test("leaves seconds alone when within a second", () => {
    const c = checkConcept(concept({ lengthSeconds: 20.5 }), "unknown");
    assert.deepEqual(c.beats.map((b) => b.seconds), [5, 15]);
  });
  test("a vague sound falls back to Instagram's name", () => {
    assert.equal(checkConcept(concept(), "Original audio - gym").audio.idea, "Original audio - gym");
    assert.equal(checkConcept(concept(), "unknown").audio.idea, "");
  });
});

const judged = (n: number, over: Partial<Judged> = {}): Judged => ({
  nicheFit: { score: n, why: "" },
  effort: { score: n, why: "" },
  formatFreshness: { score: n, why: "", similarRecentPost: "" },
  sharePotential: { score: n, why: "" },
  twist: "",
  reason: "r",
  ...over,
});

describe("viabilityOf", () => {
  test("weights add up to 100", () => {
    assert.equal(viabilityOf(judged(10), [1, 2], "other").score, 100);
    assert.equal(viabilityOf(judged(10), [0, 0], "other").score, 80); // no clip coverage costs 20
  });
  test("make now needs 70+ and no twist; a twist makes it 'twist'", () => {
    assert.equal(viabilityOf(judged(8), [1], "other").verdict, "make");
    assert.equal(viabilityOf(judged(8, { twist: "do it in a gym" }), [1], "other").verdict, "twist");
  });
  test("under 45 skips someone else's reel but never your own idea", () => {
    assert.equal(viabilityOf(judged(3), [0], "other").verdict, "skip");
    assert.equal(viabilityOf(judged(3), [0], "own").verdict, "twist");
  });
  test("a stale format vetoes a high score", () => {
    const j = judged(9, { formatFreshness: { score: 2, why: "", similarRecentPost: "Gym anime" } });
    const v = viabilityOf(j, [1], "other");
    assert.equal(v.verdict, "skip");
    assert.equal(v.vetoedBy, "formatFreshness");
    assert.equal(viabilityOf(j, [1], "own").vetoedBy, undefined);
  });
  test("factor scores are clamped to 0–10", () => {
    assert.equal(viabilityOf(judged(50), [1], "other").score, 100);
  });
});

test("coverageText", () => {
  assert.equal(coverageText([3, 0, 1]), "Beat 1: 3 likely clips · Beat 2: none · Beat 3: 1 likely clip");
});
