import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { takeContext } from "@/lib/plans";

/** The card text the take checker compares a take with. */
export async function GET(req: Request, ctx: RouteContext<"/api/host/plans/[id]/shots/[shotId]">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id, shotId } = await ctx.params;
    return Response.json(await takeContext(id, shotId));
  });
}
