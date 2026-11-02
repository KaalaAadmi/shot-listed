import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { completeUpload } from "@/lib/library";

const body = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
    .max(10_000)
    .optional(),
});

/** Finish an upload: stitches multipart uploads, checks R2 has the full file, marks it uploaded. */
export async function POST(req: Request, ctx: RouteContext<"/api/media/uploads/[id]/complete">) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut", "agent"]);
    const { id } = await ctx.params;
    const { parts } = await readJson(req, body);
    return Response.json({ asset: await completeUpload(id, parts) });
  });
}
