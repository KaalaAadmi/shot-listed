import { z } from "zod";
import { authorize } from "@/lib/auth";
import { deleteFinal, getFinal, updateFinal } from "@/lib/finals";
import { handle, readJson } from "@/lib/http";

export async function GET(req: Request, ctx: RouteContext<"/api/finals/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    return Response.json({ final: await getFinal(id) });
  });
}

const body = z
  .object({
    title: z.string().min(1).max(120),
    notes: z.string().max(2000),
    selected: z.object({
      captionId: z.string().min(1),
      text: z.string().max(5000),
      hashtags: z.array(z.string().max(100)).max(30),
    }),
    draft: z.object({
      lines: z.array(z.string().max(1000)).max(30),
      hashtags: z.array(z.string().max(100)).max(30),
    }),
  })
  .partial();

/** Rename, change notes, or save which caption you picked (and your edits to it). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/finals/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    return Response.json({ final: await updateFinal(id, await readJson(req, body)) });
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/finals/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    await deleteFinal(id);
    return new Response(null, { status: 204 });
  });
}
