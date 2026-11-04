import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { recordStep } from "@/lib/runs";

const body = z.object({
  step: z.string().max(60),
  status: z.enum(["waiting", "running", "done", "needs_you", "skipped", "failed"]),
  summary: z.string().max(300).optional(),
  error: z.string().max(300).optional(),
});

/** The host reports a step starting or ending; these drive the progress bars. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/runs/[runId]/events">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { step, ...event } = await readJson(req, body);
    await recordStep((await ctx.params).runId, step, event);
    return new Response(null, { status: 204 });
  });
}
