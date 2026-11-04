import { after } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { descriptionSchema } from "@/lib/captions/engine";
import { prepareRun, runFrom } from "@/lib/finals";
import { handle, readJson } from "@/lib/http";

export const maxDuration = 300;

const body = z.object({
  /** Omit to resume at the first unfinished step; "captions" regenerates captions only. */
  from: z.enum(["watch", "describe", "review", "captions"]).optional(),
  direction: z.string().max(500).optional(),
  /** Your corrected description from the review step. */
  description: descriptionSchema.optional(),
});

/** Retry a failed step, continue after the description check, or write a fresh round of captions. */
export async function POST(req: Request, ctx: RouteContext<"/api/finals/[id]/run">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    const { from, direction, description } = await readJson(req, body);
    const start = await prepareRun(id, from, description);
    after(() => runFrom(id, start, direction?.trim() || undefined));
    return Response.json({ started: start }, { status: 202 });
  });
}
