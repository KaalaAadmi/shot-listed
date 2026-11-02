import { authorize } from "@/lib/auth";
import { deleteFinalVideo } from "@/lib/finals";
import { handle } from "@/lib/http";

/** Delete the exported video from R2 to free space; the description and captions stay. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/finals/[id]/video">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    await deleteFinalVideo(id);
    return new Response(null, { status: 204 });
  });
}
