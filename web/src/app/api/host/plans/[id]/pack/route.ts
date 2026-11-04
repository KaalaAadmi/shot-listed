import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { packDone, packManifest } from "@/lib/plans";

/** What to cut for the clip pack. */
export async function GET(req: Request, ctx: RouteContext<"/api/host/plans/[id]/pack">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    return Response.json(await packManifest((await ctx.params).id));
  });
}

const body = z.object({ storageAssetId: z.string().uuid() });

/** The zip is in storage. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/plans/[id]/pack">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    await packDone((await ctx.params).id, (await readJson(req, body)).storageAssetId);
    return new Response(null, { status: 204 });
  });
}
