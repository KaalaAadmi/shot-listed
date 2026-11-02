import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { downloadUrl } from "@/lib/library";

/** Redirects to a signed URL that downloads the original with its file name. */
export async function GET(req: Request, ctx: RouteContext<"/api/media/assets/[id]/download">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    return Response.redirect(await downloadUrl(id), 302);
  });
}
