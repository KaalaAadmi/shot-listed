import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { hostItem } from "@/lib/library-items";

/** What the host needs before indexing: the file's kind, name and claimed hash. 404 once the item is gone. */
export async function GET(req: Request, ctx: RouteContext<"/api/host/items/[id]">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id } = await ctx.params;
    return Response.json(await hostItem(id));
  });
}
