import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { numbersSchema } from "@/lib/plan-rules.ts";
import { getPlan, markPosted, setStatus } from "@/lib/plans";

export async function GET(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json(await getPlan((await ctx.params).id));
  });
}

const body = z.object({
  status: z.enum(["planned", "filming", "editing", "ready", "posted", "skipped"]),
  numbers: numbersSchema.optional(),
});

/** Moves the plan to another board column. Posted can carry the numbers you typed. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { status, numbers } = await readJson(req, body);
    const { id } = await ctx.params;
    if (status === "posted") await markPosted(id, numbers ?? {});
    else await setStatus(id, status);
    return new Response(null, { status: 204 });
  });
}
