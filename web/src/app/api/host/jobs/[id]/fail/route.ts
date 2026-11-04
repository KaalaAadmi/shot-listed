import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { fail } from "@/lib/jobs";
import { markFailed } from "@/lib/inspirations";
import { markTakeFailed, packFailed } from "@/lib/plans";
import { markIndexFailed } from "@/lib/library-match";

const body = z.object({ error: z.string().max(2000) });

/** Requeues the job, or gives up after three attempts (the item or shared reel is then marked failed). */
export async function POST(req: Request, ctx: RouteContext<"/api/host/jobs/[id]/fail">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id } = await ctx.params;
    const { error } = await readJson(req, body);
    const job = await fail(id, error);
    if (job?.status === "failed" && job.type === "index-asset") await markIndexFailed(String(job.payload.itemId), error);
    if (job?.status === "failed" && (job.type === "ingest-inspiration" || job.type === "analyse-inspiration")) {
      await markFailed(String(job.payload.inspirationId), error);
    }
    if (job?.status === "failed" && job.type === "check-take") {
      await markTakeFailed(String(job.payload.planId), String(job.payload.shotId), String(job.payload.assetId), error);
    }
    if (job?.status === "failed" && job.type === "clip-pack") await packFailed(String(job.payload.planId));
    return new Response(null, { status: 204 });
  });
}
