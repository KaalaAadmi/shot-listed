import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { claim } from "@/lib/jobs";

/** The pipeline host asks for its next job (leased for 10 minutes). 204 when there is none. */
export async function POST(req: Request) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const job = await claim();
    return job
      ? Response.json({ job: { id: job._id, type: job.type, payload: job.payload, runId: job.runId ?? null, attempts: job.attempts } })
      : new Response(null, { status: 204 });
  });
}
