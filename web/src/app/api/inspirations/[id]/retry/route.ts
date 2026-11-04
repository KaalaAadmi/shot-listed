import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { retry } from "@/lib/inspirations";

// Retrying a failed score calls the model inline.
export const maxDuration = 120;

export async function POST(req: Request, ctx: RouteContext<"/api/inspirations/[id]/retry">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await retry((await ctx.params).id);
    return new Response(null, { status: 204 });
  });
}
