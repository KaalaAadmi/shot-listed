import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { attachTake, overrideTake } from "@/lib/plans";

const body = z.object({ assetId: z.string().uuid() });

/** A video you filmed for this card (already uploaded to the library); the host checks it. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/shots/[shotId]/takes">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id, shotId } = await ctx.params;
    await attachTake(id, shotId, (await readJson(req, body)).assetId);
    return new Response(null, { status: 202 });
  });
}

/** Use anyway: put this take on the shot whatever the check said. */
export async function PUT(req: Request, ctx: RouteContext<"/api/plans/[id]/shots/[shotId]/takes">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id, shotId } = await ctx.params;
    await overrideTake(id, shotId, (await readJson(req, body)).assetId);
    return new Response(null, { status: 204 });
  });
}
