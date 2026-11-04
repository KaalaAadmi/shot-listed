// Keeps ../prompts honest: every prompt file parses, its variables are declared, and its
// output schema is one both Claude and Gemini accept (closed objects, everything required,
// no min/max/pattern/format keywords). The shared concept must be identical everywhere.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "..", "prompts");
const schemaDir = join(dir, "schemas");
const FORBIDDEN = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format", "oneOf", "anyOf", "$ref"];
// Inputs that are attachments, not text variables in the templates.
const ATTACHMENTS = new Set(["images", "video"]);

type Schema = Record<string, unknown>;

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  assert.ok(m, "frontmatter missing");
  return Object.fromEntries(
    m[1].split("\n").map((l) => {
      const at = l.indexOf(":");
      return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
    }),
  );
}

function block(md: string, heading: string): string {
  const m = new RegExp(`## ${heading}\\n\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``).exec(md);
  assert.ok(m, `"## ${heading}" with a text block is missing`);
  return m[1];
}

function walk(node: unknown, path: string, problems: string[]) {
  if (!node || typeof node !== "object") return;
  const s = node as Schema;
  for (const k of FORBIDDEN) if (k in s) problems.push(`${path}: uses "${k}"`);
  if (s.type === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    if (s.additionalProperties !== false) problems.push(`${path}: not closed`);
    const required = new Set((s.required ?? []) as string[]);
    for (const p of Object.keys(props)) if (!required.has(p)) problems.push(`${path}.${p}: not required`);
    for (const [p, v] of Object.entries(props)) walk(v, `${path}.${p}`, problems);
  }
  if (s.type === "array") walk(s.items, `${path}[]`, problems);
  if (Array.isArray(s.type)) problems.push(`${path}: type arrays (nullable) aren't allowed; use "" or 0`);
}

const strip = (s: Schema) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$schema" && k !== "title"));

const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && !f.endsWith(".default.md"));

describe("prompt files", () => {
  test("there is a prompt for every schema except the shared concept", () => {
    const schemas = readdirSync(schemaDir).map((f) => f.replace(/\.json$/, "")).filter((n) => n !== "concept");
    assert.deepEqual(files.map((f) => f.replace(/\.md$/, "")).sort(), schemas.sort());
  });

  for (const file of files) {
    test(file, () => {
      const md = readFileSync(join(dir, file), "utf8");
      const fm = frontmatter(md);
      assert.equal(`${fm.id}.md`, file, "id matches the file name");
      assert.match(fm.model, /^(caption|video|vision|cheap)$/);
      assert.ok(Number(fm.version) >= 1);

      const declared = new Set(fm.inputs.replace(/[[\]]/g, "").split(",").map((s) => s.trim()));
      const text = block(md, "System") + "\n" + block(md, "User");
      const used = new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      for (const v of used) assert.ok(declared.has(v), `{{${v}}} is used but not in inputs`);
      for (const v of declared) if (!ATTACHMENTS.has(v)) assert.ok(used.has(v), `input "${v}" is never used`);

      const schema = JSON.parse(readFileSync(join(dir, fm.output), "utf8")) as Schema;
      const problems: string[] = [];
      walk(schema, fm.id, problems);
      assert.deepEqual(problems, []);
    });
  }

  test("every embedded concept is identical to schemas/concept.json", () => {
    const concept = strip(JSON.parse(readFileSync(join(schemaDir, "concept.json"), "utf8")));
    for (const name of ["inspiration-analysis", "brief-maker"]) {
      const s = JSON.parse(readFileSync(join(schemaDir, `${name}.json`), "utf8")) as { properties: { concept: Schema } };
      assert.deepEqual(s.properties.concept, concept, name);
    }
  });
});

describe("renderPrompt", () => {
  test("fills variables, leaves none behind, and stamps the version", async () => {
    const { renderPrompt } = await import("../src/lib/prompts.ts");
    const p = renderPrompt("caption-feedback", {
      voicePrompt: "VOICE",
      contentHistory: "HISTORY",
      description: "DESC",
      options: "OPTS",
      draft: "1. Hook",
      codeChecks: "Characters: 4 of 2200",
      thread: "",
      question: "Too long?",
    });
    assert.match(p.system, /^VOICE\n\nHISTORY/);
    assert.match(p.user, /<question>\nToo long\?\n<\/question>/);
    assert.doesNotMatch(p.system + p.user, /\{\{/);
    assert.match(p.prompt, /^caption-feedback@\d+$/);
    assert.throws(() => renderPrompt("nope", {}));
  });
});

test("promptStamp is id@version", async () => {
  const { promptStamp } = await import("../src/lib/prompts.ts");
  assert.match(promptStamp("write-captions"), /^write-captions@\d+$/);
  assert.throws(() => promptStamp("nope"));
});
