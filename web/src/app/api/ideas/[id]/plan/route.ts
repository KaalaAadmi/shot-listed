import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { makePlan } from "@/lib/ideas";

/** Make the plan from the brief. */
export async function POST(req: Request, ctx: RouteContext<"/api/ideas/[id]/plan">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ planId: await makePlan((await ctx.params).id) });
  });
}
