import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { complete } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/host/jobs/[id]/complete">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id } = await ctx.params;
    await complete(id);
    return new Response(null, { status: 204 });
  });
}
