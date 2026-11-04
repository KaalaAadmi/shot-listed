import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { attachFile } from "@/lib/inspirations";

/** The fallback when Instagram won't let the host download a reel: upload the video yourself. */
export async function POST(req: Request, ctx: RouteContext<"/api/inspirations/[id]/file">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { assetId } = await readJson(req, z.object({ assetId: z.string().uuid() }));
    await attachFile((await ctx.params).id, assetId);
    return new Response(null, { status: 204 });
  });
}
