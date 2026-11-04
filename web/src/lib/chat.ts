import "server-only";
import { visionModel } from "./finals";
import { renderPrompt } from "./prompts.ts";

// Long idea and plan chats: the oldest turns are folded into one short note (prompts/chat-summariser.md).
// All turns stay saved; only what the model sees is shortened.

export const CHAT_LIMIT = 60;
const KEEP = 20;

type Turn = { role: "you" | "model"; text: string };

const lines = (turns: Turn[]) => turns.map((t) => `${t.role === "you" ? "Me" : "You"}: ${t.text}`).join("\n");

/** What the model sees of a chat: the note for folded turns, then the rest. */
export function threadText(chat: Turn[], folded: number, summary: string | undefined): string {
  return [summary && folded ? `Earlier in this chat: ${summary}` : "", lines(chat.slice(folded))].filter(Boolean).join("\n\n");
}

/** Folds the oldest turns once more than CHAT_LIMIT are unfolded. Returns the new note and count, or null. */
export async function foldChat(
  kind: "idea chat" | "plan chat",
  chat: Turn[],
  folded: number,
  summary: string | undefined,
): Promise<{ summary: string; folded: number } | null> {
  if (chat.length - folded <= CHAT_LIMIT) return null;
  const upTo = chat.length - KEEP;
  const p = renderPrompt("chat-summariser", { kind, previousSummary: summary ?? "", turns: lines(chat.slice(folded, upTo)) });
  const raw = (await visionModel().generateJson({ system: p.system, parts: [{ text: p.user }], schema: p.schema, temperature: p.temperature })) as { summary?: string };
  if (!raw.summary?.trim()) return null;
  return { summary: raw.summary.trim().slice(0, 1200), folded: upTo };
}
