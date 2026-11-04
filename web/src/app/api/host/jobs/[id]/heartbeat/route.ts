import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { heartbeat } from "@/lib/jobs";

/** Extends the lease. 409 tells the host the job was handed on, so it should stop. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/jobs/[id]/heartbeat">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id } = await ctx.params;
    return (await heartbeat(id)) ? new Response(null, { status: 204 }) : Response.json({ error: "Job is not running" }, { status: 409 });
  });
}
