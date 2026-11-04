// Same-shot rules (docs/TRD.md §4.1) and tag cleanup.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  betterFile,
  cleanTags,
  compareShots,
  cosine,
  embeddingText,
  hamming,
  matchesFinalCut,
  type Facts,
} from "../src/lib/library-index.ts";

const base: Facts = {
  id: "a",
  kind: "photo",
  atS: 1_700_000_000,
  subsec: 0.45,
  width: 3024,
  height: 4032,
  phash: ["ffff0000ffff0000"],
  contentHash: "h1",
  size: 3_000_000,
  contentType: "image/heic",
};
// Flips the lowest `bits` bits of a 16-hex-digit hash.
const flip = (hex: string, bits: number) =>
  [...hex]
    .map((c, i) => {
      const fromEnd = hex.length - 1 - i;
      const mask = Math.max(0, Math.min(4, bits - fromEnd * 4));
      return (parseInt(c, 16) ^ ((1 << mask) - 1)).toString(16);
    })
    .join("");

describe("same shot", () => {
  test("hamming counts differing bits", () => {
    assert.equal(hamming("0000000000000000", "ffffffffffffffff"), 64);
    assert.equal(hamming("ff", "fe"), 1);
  });

  test("HEIC and JPEG of one shot are Same, and the HEIC wins", () => {
    const jpeg = { ...base, id: "b", contentType: "image/jpeg", contentHash: "h2", phash: [flip(base.phash[0], 2)] };
    const m = compareShots(base, jpeg)!;
    assert.equal(m.verdict, "same");
    assert.equal(m.betterFile, "keep");
    assert.equal(compareShots(jpeg, { ...base, id: "c" })!.betterFile, "other");
  });

  test("a burst shot a moment later is not Same", () => {
    const next = { ...base, id: "b", subsec: 0.55, phash: [flip(base.phash[0], 3)] };
    assert.equal(compareShots(base, next)!.verdict, "possible");
  });

  test("without sub-seconds only a near-identical hash is Same", () => {
    const close = { ...base, id: "b", subsec: undefined, phash: [flip(base.phash[0], 2)] };
    const looser = { ...base, id: "c", subsec: undefined, phash: [flip(base.phash[0], 4)] };
    assert.equal(compareShots(base, close)!.verdict, "same");
    assert.equal(compareShots(base, looser)!.verdict, "possible");
  });

  test("different shots, kinds or orientations never match", () => {
    assert.equal(compareShots(base, { ...base, id: "b", phash: [flip(base.phash[0], 20)] }), null);
    assert.equal(compareShots(base, { ...base, id: "b", atS: base.atS + 5 }), null);
    assert.equal(compareShots(base, { ...base, id: "b", width: 4032, height: 3024 }), null);
    assert.equal(compareShots(base, { ...base, id: "b", kind: "video", durationS: 3 }), null);
  });

  test("videos need frames and durations to agree", () => {
    const v: Facts = { ...base, kind: "video", durationS: 10, phash: [base.phash[0], "00ff00ff00ff00ff", "f0f0f0f0f0f0f0f0"] };
    const copy = { ...v, id: "b", durationS: 10.05, phash: v.phash.map((h) => flip(h, 5)) };
    assert.equal(compareShots(v, copy)!.verdict, "same");
    assert.equal(compareShots(v, { ...copy, durationS: 10.3 })!.verdict, "possible");
    assert.equal(compareShots(v, { ...copy, durationS: 12 }), null);
  });

  test("better file: pixels, then bitrate", () => {
    const small = { ...base, width: 1000, height: 1000 };
    assert.equal(betterFile(small, base), "other");
    const v: Facts = { ...base, kind: "video", durationS: 10, size: 10 };
    assert.equal(betterFile(v, { ...v, size: 20 }), "other");
  });

  test("final cut: same bytes, or same length and look", () => {
    const v: Facts = { ...base, kind: "video", durationS: 20, phash: ["aa", "bb", "cc"] };
    assert.equal(matchesFinalCut({ ...v, id: "x", contentHash: "h1" }, { ...v, id: "f", contentHash: "h1" }), true);
    assert.equal(matchesFinalCut({ ...v, id: "x", contentHash: "h9" }, { ...v, id: "f", durationS: 20.2 }), true);
    assert.equal(matchesFinalCut({ ...v, id: "x", contentHash: "h9" }, { ...v, id: "f", durationS: 25 }), false);
  });
});

describe("tags", () => {
  const tags = {
    caption: "  Man doing dips  ",
    setting: "gym",
    shotType: "medium",
    action: "doing dips",
    mood: "focused",
    peopleCount: 1,
    faceVisible: true,
    visibleText: "",
    objects: Array.from({ length: 12 }, (_, i) => `o${i}`),
    useFor: ["a", "b", "c", "d", "e", " "],
    quality: { sharp: true, wellLit: true, stable: true, note: "" },
    unusable: false,
    unusableReason: "left over",
  };

  test("lists are capped and text trimmed", () => {
    const t = cleanTags(tags);
    assert.equal(t.objects.length, 8);
    assert.deepEqual(t.useFor, ["a", "b", "c", "d"]);
    assert.equal(t.caption, "Man doing dips");
    assert.equal(t.unusableReason, "");
  });

  test("embedding text and cosine", () => {
    assert.match(embeddingText(cleanTags(tags)), /^Man doing dips\. doing dips, o0/);
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
  });
});
