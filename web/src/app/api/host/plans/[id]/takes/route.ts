import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { recordTake } from "@/lib/plans";

/** The host's verdict on a take (validated against takeResultSchema). */
export async function POST(req: Request, ctx: RouteContext<"/api/host/plans/[id]/takes">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    await recordTake((await ctx.params).id, await req.json());
    return new Response(null, { status: 204 });
  });
}
