import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { swapAlternate } from "@/lib/plans";

const body = z.object({ alternate: z.number().int().min(1) });

/** Tap an alternate clip to use it for this shot. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/shots/[shotId]/alternate">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id, shotId } = await ctx.params;
    await swapAlternate(id, shotId, (await readJson(req, body)).alternate);
    return new Response(null, { status: 204 });
  });
}
