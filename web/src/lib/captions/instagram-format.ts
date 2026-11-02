// Turns a caption into text that survives being pasted into Instagram.
// Instagram strips empty lines and the spaces around each line when it publishes,
// so a blank line has to hold a character. U+2800 (Braille Pattern Blank) renders
// as nothing but counts as content, which is what caption-formatting tools use.
// No server or browser imports: shared by the API, the UI and the tests.

export const BLANK_LINE = "⠀";
export const MAX_CAPTION_CHARS = 2200;
/** Instagram allows 5 hashtags per post (including Reels). */
export const MAX_HASHTAGS = 5;

export type HashtagPlacement = "caption" | "first-comment";

export type FormattedCaption = {
  text: string;
  /** What Instagram counts: every UTF-16 code unit, like its own counter. */
  charCount: number;
  hashtagCount: number;
  warnings: string[];
};

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

export function normaliseHashtag(tag: string): string | null {
  const cleaned = tag.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned ? `#${cleaned}` : null;
}

/** Dedupe, clean and cap a hashtag list. */
export function cleanHashtags(tags: string[], max = MAX_HASHTAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = normaliseHashtag(t);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === max) break;
  }
  return out;
}

export function countHashtags(text: string): number {
  return text.match(HASHTAG)?.length ?? 0;
}

/**
 * Keeps the line structure you see in the editor:
 *  - Windows/Mac line endings and non-breaking spaces become plain ones
 *  - spaces at the start and end of each line are removed (Instagram drops them anyway,
 *    and a trailing space before a line break can swallow the break)
 *  - any run of blank lines becomes one spacer line holding U+2800
 *  - blank lines at the very start or end are removed
 */
export function preserveLineBreaks(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t⠀]+$/u, "").replace(/^[ \t]+/, ""));

  const out: string[] = [];
  for (const line of lines) {
    const blank = line.replace(/⠀/g, "").trim() === "";
    if (blank) {
      if (out.length > 0 && out[out.length - 1] !== BLANK_LINE) out.push(BLANK_LINE);
    } else {
      out.push(line);
    }
  }
  while (out[out.length - 1] === BLANK_LINE) out.pop();
  return out.join("\n");
}

/**
 * The text to paste into Instagram. Hashtags go on their own last line (your Section 4,
 * line 5), optionally after a blank spacer line, or are left out when they go in the
 * first comment.
 */
export function formatForInstagram(
  caption: string,
  hashtags: string[],
  placement: HashtagPlacement,
  opts: { blankLineBeforeHashtags?: boolean } = {},
): FormattedCaption {
  const body = preserveLineBreaks(caption);
  const tags = cleanHashtags(hashtags);
  const spacer = opts.blankLineBeforeHashtags ? `\n${BLANK_LINE}` : "";
  const text =
    placement === "caption" && tags.length > 0 ? `${body}${spacer}\n${tags.join(" ")}` : body;

  const hashtagCount = countHashtags(text);
  const warnings: string[] = [];
  if (text.length > MAX_CAPTION_CHARS) {
    warnings.push(`${text.length} characters; Instagram allows ${MAX_CAPTION_CHARS}.`);
  }
  if (hashtagCount > MAX_HASHTAGS) {
    warnings.push(`${hashtagCount} hashtags; Instagram allows ${MAX_HASHTAGS} per post.`);
  }
  return { text, charCount: text.length, hashtagCount, warnings };
}

/** The hashtags line, for pasting as the first comment or on its own. */
export function hashtagLine(hashtags: string[]): string {
  return cleanHashtags(hashtags).join(" ");
}
