import { z } from "zod";
import { authorize } from "@/lib/auth";
import { clearFeedback, giveFeedback } from "@/lib/finals";
import { handle, readJson } from "@/lib/http";

export const maxDuration = 120;

const body = z.object({
  draft: z.object({
    lines: z.array(z.string().max(1000)).max(30),
    hashtags: z.array(z.string().max(100)).max(30),
  }),
  question: z.string().max(1000).optional(),
});

/** One feedback call on your draft (5–20 seconds). Returns the updated final cut with the thread. */
export async function POST(req: Request, ctx: RouteContext<"/api/finals/[id]/feedback">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    const { draft, question } = await readJson(req, body);
    return Response.json({ final: await giveFeedback(id, draft, question?.trim() ?? "") });
  });
}

/** Clear: start a fresh thread. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/finals/[id]/feedback">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    return Response.json({ final: await clearFeedback(id) });
  });
}
