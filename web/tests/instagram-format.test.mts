import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_LINE,
  cleanHashtags,
  formatForInstagram,
  hashtagLine,
  preserveLineBreaks,
} from "../src/lib/captions/instagram-format.ts";

describe("preserveLineBreaks", () => {
  test("blank lines hold U+2800 so Instagram keeps them", () => {
    assert.equal(preserveLineBreaks("Hook line\n\nSecond line"), `Hook line\n${BLANK_LINE}\nSecond line`);
  });

  test("several blank lines become one spacer", () => {
    assert.equal(preserveLineBreaks("a\n\n\n\nb"), `a\n${BLANK_LINE}\nb`);
  });

  test("trailing and leading spaces are removed from each line", () => {
    assert.equal(preserveLineBreaks("  first line   \nsecond\t"), "first line\nsecond");
  });

  test("Windows line endings and non-breaking spaces are normalised", () => {
    assert.equal(preserveLineBreaks("a\r\n\r\nb c"), `a\n${BLANK_LINE}\nb c`);
  });

  test("no spacer at the start or end", () => {
    assert.equal(preserveLineBreaks("\n\nhello\n\n"), "hello");
  });

  test("formatting twice gives the same result", () => {
    const once = preserveLineBreaks("a\n\nb\n\n\nc");
    assert.equal(preserveLineBreaks(once), once);
  });
});

describe("hashtags", () => {
  test("cleaned, deduped case-insensitively and capped at 5", () => {
    assert.deepEqual(cleanHashtags(["#Gym", "gym", "  #expat life", "##dublin", "a", "b", "c", "d"]), [
      "#Gym",
      "#expatlife",
      "#dublin",
      "#a",
      "#b",
    ]);
  });

  test("go on the line right under the caption, as in your Section 4 structure", () => {
    const caption = "Hook line\nContext sentence.\nWho else does this?";
    const out = formatForInstagram(caption, ["gym", "dublin"], "caption");
    assert.equal(out.text, `${caption}\n#gym #dublin`);
    assert.equal(out.hashtagCount, 2);
    assert.deepEqual(out.warnings, []);
  });

  test("optionally after a blank spacer line", () => {
    const out = formatForInstagram("Caption", ["gym"], "caption", { blankLineBeforeHashtags: true });
    assert.equal(out.text, `Caption\n${BLANK_LINE}\n#gym`);
  });

  test("left out of the caption when they go in the first comment", () => {
    const out = formatForInstagram("Caption", ["gym", "#Dublin"], "first-comment");
    assert.equal(out.text, "Caption");
    assert.equal(hashtagLine(["gym", "#Dublin", "GYM"]), "#gym #Dublin");
  });

  test("every line break in the caption survives", () => {
    const out = formatForInstagram("one\ntwo\nthree\nfour", ["a"], "caption");
    assert.equal(out.text.split("\n").length, 5);
  });

  test("warns when the caption already carries too many hashtags", () => {
    const out = formatForInstagram("#a #b #c #d", ["e", "f"], "caption");
    assert.equal(out.hashtagCount, 6);
    assert.equal(out.warnings.length, 1);
  });

  test("warns past 2,200 characters", () => {
    assert.equal(formatForInstagram("x".repeat(2201), [], "caption").warnings.length, 1);
  });
});
