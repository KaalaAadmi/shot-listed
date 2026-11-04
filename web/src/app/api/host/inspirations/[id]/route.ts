import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { forHost } from "@/lib/inspirations";

/** What the host needs to download or watch a shared reel. */
export async function GET(req: Request, ctx: RouteContext<"/api/host/inspirations/[id]">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    return Response.json(await forHost((await ctx.params).id));
  });
}
