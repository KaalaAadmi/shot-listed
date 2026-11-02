import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { abortUpload, uploadState } from "@/lib/library";

/** Where an upload got to: `resume` with the parts R2 has, a fresh link, or `duplicate` if done. */
export async function GET(req: Request, ctx: RouteContext<"/api/media/uploads/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut", "agent"]);
    const { id } = await ctx.params;
    return Response.json(await uploadState(id));
  });
}

/** Cancel an upload that hasn't finished; removes any parts already in R2. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/media/uploads/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut", "agent"]);
    const { id } = await ctx.params;
    await abortUpload(id);
    return new Response(null, { status: 204 });
  });
}
