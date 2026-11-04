import "server-only";
import { GoogleGenAI } from "@google/genai";
import { HttpError } from "./auth";
import { env } from "./env";
import { EMBED_DIMS, EMBED_MODEL } from "./library-index.ts";

/** Embeds text for library search. The host uses the same model and size, or the vectors wouldn't compare. */
export async function embed(text: string): Promise<number[]> {
  const { GEMINI_API_KEY } = env();
  if (!GEMINI_API_KEY) throw new HttpError(503, "Add GEMINI_API_KEY to search the library");
  const res = await new GoogleGenAI({ apiKey: GEMINI_API_KEY }).models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { outputDimensionality: EMBED_DIMS },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values?.length) throw new Error("Gemini returned no embedding");
  return values;
}
