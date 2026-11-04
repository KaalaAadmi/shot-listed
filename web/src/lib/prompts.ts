// Loads the prompt files in ../prompts (bundled by scripts/build-prompts.mts) and fills their {{variables}}.
// No server or browser imports: shared by the API and the tests.
import data from "./prompts.generated.json" with { type: "json" };

type PromptFile = { version: number; temperature: number; system: string; user: string; schema: Record<string, unknown> };
const files = data as Record<string, PromptFile>;

export type RenderedPrompt = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  temperature: number;
  /** Stored with results, e.g. "write-captions@1", so before and after a prompt change can be compared. */
  prompt: string;
};

/** "id@version" of a prompt, stored with every result it produced. */
export function promptStamp(id: string): string {
  const file = files[id];
  if (!file) throw new Error(`No prompt called "${id}"`);
  return `${id}@${file.version}`;
}

/** Variables are replaced as plain text; one with no value becomes an empty string. */
export function renderPrompt(id: string, vars: Record<string, string>): RenderedPrompt {
  const file = files[id];
  if (!file) throw new Error(`No prompt called "${id}"`);
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");
  return {
    system: fill(file.system),
    user: fill(file.user),
    schema: file.schema,
    temperature: file.temperature,
    prompt: `${id}@${file.version}`,
  };
}
