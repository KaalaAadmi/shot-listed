import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { recordAnalysis } from "@/lib/inspirations";

// Saving the analysis also scores the reel, which calls a model.
export const maxDuration = 120;

/** The host's Gemini output for prompts/inspiration-analysis.md; validated against the schema in recordAnalysis. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/inspirations/[id]/analysed">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    await recordAnalysis((await ctx.params).id, await req.json());
    return new Response(null, { status: 204 });
  });
}
