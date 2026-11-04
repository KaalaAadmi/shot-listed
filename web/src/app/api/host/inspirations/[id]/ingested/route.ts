import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { recordIngested } from "@/lib/inspirations";

const count = z.number().int().nonnegative().nullable();
const body = z.object({
  storageAssetId: z.string().uuid(),
  meta: z.object({
    creator: z.string().max(100),
    caption: z.string().max(5000),
    views: count,
    likes: count,
    comments: count,
    durationS: z.number().nonnegative().nullable(),
    audio: z.object({ title: z.string().max(200), isOriginal: z.boolean().nullable() }),
  }),
});

/** The host stored the downloaded reel; the next job watches it. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/inspirations/[id]/ingested">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { storageAssetId, meta } = await readJson(req, body);
    await recordIngested((await ctx.params).id, storageAssetId, meta);
    return new Response(null, { status: 204 });
  });
}
