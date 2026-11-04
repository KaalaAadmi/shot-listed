import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { resolveDuplicate } from "@/lib/library-match";

const body = z.object({ action: z.enum(["merge", "keep-both", "undo"]) });

export async function POST(req: Request, ctx: RouteContext<"/api/media/duplicates/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    await resolveDuplicate(decodeURIComponent(id), (await readJson(req, body)).action);
    return new Response(null, { status: 204 });
  });
}
