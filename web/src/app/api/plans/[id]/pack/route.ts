import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { requestPack } from "@/lib/plans";

/** Make the clip pack: the plan's clips, trimmed and numbered in shot order, as a zip. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/pack">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await requestPack((await ctx.params).id);
    return new Response(null, { status: 202 });
  });
}
