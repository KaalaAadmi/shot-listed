import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { rerun } from "@/lib/plans";

export const maxDuration = 300;

const body = z.object({ from: z.enum(["matching", "stock", "writing"]) });

/** Retry from a step of the pipeline view (or after a failed build). */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/rerun">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await rerun((await ctx.params).id, (await readJson(req, body)).from);
    return new Response(null, { status: 202 });
  });
}
