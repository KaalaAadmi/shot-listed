import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { deleteAsset, getAsset } from "@/lib/library";
import { patchItem } from "@/lib/library-items";

const patch = z.object({
  excluded: z.boolean().optional(),
  tags: z
    .object({
      caption: z.string().min(1).max(500).optional(),
      setting: z.string().max(40).optional(),
      shotType: z.string().max(40).optional(),
      action: z.string().max(300).optional(),
      mood: z.string().max(100).optional(),
    })
    .optional(),
});

/** Exclude an item from plans, or correct its tags (the search embedding follows). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/media/assets/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    return Response.json({ asset: await patchItem(id, await readJson(req, patch)) });
  });
}

export async function GET(req: Request, ctx: RouteContext<"/api/media/assets/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner", "agent"]);
    const { id } = await ctx.params;
    return Response.json({ asset: await getAsset(id) });
  });
}

/** Removes the item from R2 (original, proxy and thumbnail) and from the library. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/media/assets/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const { id } = await ctx.params;
    await deleteAsset(id);
    return new Response(null, { status: 204 });
  });
}
