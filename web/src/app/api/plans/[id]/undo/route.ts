import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { undo } from "@/lib/plans";

export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/undo">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await undo((await ctx.params).id);
    return new Response(null, { status: 204 });
  });
}
