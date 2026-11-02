import { after } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { prepareRun, runFrom } from "@/lib/finals";
import { handle, readJson } from "@/lib/http";

export const maxDuration = 300;

const body = z.object({
  /** Omit to resume at the first unfinished step; "captions" regenerates captions only. */
  from: z.enum(["watch", "describe", "captions"]).optional(),
  direction: z.string().max(500).optional(),
});

/** Retry a failed step, or write a fresh round of captions with optional direction. */
export async function POST(req: Request, ctx: RouteContext<"/api/finals/[id]/run">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    const { from, direction } = await readJson(req, body);
    const start = await prepareRun(id, from);
    after(() => runFrom(id, start, direction?.trim() || undefined));
    return Response.json({ started: start }, { status: 202 });
  });
}
