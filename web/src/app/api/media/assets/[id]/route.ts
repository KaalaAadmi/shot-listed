import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { deleteAsset, getAsset } from "@/lib/library";

export async function GET(req: Request, ctx: RouteContext<"/api/media/assets/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner", "agent"]);
    const { id } = await ctx.params;
    return Response.json({ asset: await getAsset(id) });
  });
}

/** Removes the item from R2 (original, proxy and thumbnail) and from the library. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/media/assets/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    await deleteAsset(id);
    return new Response(null, { status: 204 });
  });
}
