import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { make } from "@/lib/inspirations";

export const maxDuration = 60;

/** Make, or Make anyway on a Skip. */
export async function POST(req: Request, ctx: RouteContext<"/api/inspirations/[id]/make">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ planId: await make((await ctx.params).id) });
  });
}
