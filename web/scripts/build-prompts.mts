// Bundles ../prompts/*.md and their schemas into src/lib/prompts.generated.json, so the app
// never reads files at runtime (Vercel only ships what the build includes).
//   npm run prompts       (also runs before build and test)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "..", "prompts");
const out = join(import.meta.dirname, "..", "src", "lib", "prompts.generated.json");

// Vercel may build with only web/ present; the committed bundle is used then.
if (!existsSync(dir)) {
  console.log("../prompts not found; keeping the committed src/lib/prompts.generated.json");
  process.exit(0);
}

const block = (md: string, heading: string, id: string): string => {
  const m = new RegExp(`## ${heading}\\n\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``).exec(md);
  if (!m) throw new Error(`${id}: "## ${heading}" with a text block is missing`);
  return m[1];
};

const prompts: Record<string, unknown> = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && !f.endsWith(".default.md")).sort()) {
  const md = readFileSync(join(dir, file), "utf8");
  const fm = Object.fromEntries(
    (/^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  const schema = JSON.parse(readFileSync(join(dir, fm.output), "utf8")) as Record<string, unknown>;
  delete schema.$schema; // the models take the schema itself, not its metadata
  delete schema.title;
  prompts[fm.id] = {
    version: Number(fm.version),
    temperature: Number(fm.temperature),
    system: block(md, "System", fm.id),
    user: block(md, "User", fm.id),
    schema,
  };
}
writeFileSync(out, JSON.stringify(prompts, null, 2) + "\n");
console.log(`${Object.keys(prompts).length} prompts → src/lib/prompts.generated.json`);
