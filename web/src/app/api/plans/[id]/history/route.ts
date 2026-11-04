import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { addToHistory, draftHistory } from "@/lib/plans";

export const maxDuration = 120;

/** The content-history writer drafts an entry for this posted reel. Nothing is saved. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/history">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { entry, tier, lesson } = await draftHistory((await ctx.params).id);
    return Response.json({ entry, tier, lesson });
  });
}

/** Add to history: appends your edited entry to Settings → Content history. */
export async function PUT(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await addToHistory((await readJson(req, z.object({ entry: z.string().min(1).max(4000) }))).entry);
    return new Response(null, { status: 204 });
  });
}
