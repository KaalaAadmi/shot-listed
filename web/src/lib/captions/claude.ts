import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { JsonModel } from "./model.ts";

/**
 * Claude for the caption step. Your Social Media Manager prompt was written for Claude,
 * so when ANTHROPIC_API_KEY is set the captions use it; Gemini still watches the video.
 * Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
export function claudeModel(apiKey: string, model: string): JsonModel {
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  return {
    label: `Claude (${model})`,

    async generateJson({ system, parts, schema }) {
      const text = parts.map((p) => {
        if (!("text" in p)) throw new Error("Claude can't watch video or look at images here; Gemini handles that step");
        return p.text;
      });

      const res = await client.messages.create({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: text.join("\n\n") }],
        output_config: { format: { type: "json_schema", schema } },
      });

      if (res.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off; try again");
      if (res.stop_reason === "refusal") throw new Error("Claude declined to write captions for this reel");
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("Claude returned no text");
      try {
        return JSON.parse(block.text) as unknown;
      } catch {
        throw new Error("Claude returned text that is not valid JSON");
      }
    },
  };
}
