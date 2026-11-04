import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { linkFinal } from "@/lib/plans";

/** Links a final cut you already captioned to this plan. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/final">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { finalId } = await readJson(req, z.object({ finalId: z.string().uuid() }));
    await linkFinal((await ctx.params).id, finalId);
    return new Response(null, { status: 204 });
  });
}
