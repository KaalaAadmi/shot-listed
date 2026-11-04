import "server-only";
import { collections } from "./db";
import { env } from "./env";
import type { StockDoc } from "./types";

type PexelsVideo = { id: number; url: string; duration: number; width: number; height: number; user: { name: string } };

/**
 * Vertical stock clips for a search, cached for 30 days by query (Pexels allows 200 requests an hour).
 * Empty when there is no key, so plans simply fall back to Film it cards.
 */
export async function searchStock(query: string): Promise<StockDoc["results"]> {
  const key = env().PEXELS_API_KEY;
  if (!key || !query.trim()) return [];
  const { stock } = await collections();
  const id = `${query.toLowerCase().trim()}|portrait`;
  const cached = await stock.findOne({ _id: id });
  if (cached) return cached.results;
  const res = await fetch(`https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation: "portrait", per_page: "5" })}`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Pexels returned ${res.status}`);
  const body = (await res.json()) as { videos?: PexelsVideo[] };
  const results = (body.videos ?? []).map((v) => ({
    pexelsId: v.id,
    url: v.url,
    credit: `Video by ${v.user.name} on Pexels`,
    duration: v.duration,
    width: v.width,
    height: v.height,
  }));
  await stock.updateOne({ _id: id }, { $set: { results, fetchedAt: new Date() } }, { upsert: true });
  return results;
}
