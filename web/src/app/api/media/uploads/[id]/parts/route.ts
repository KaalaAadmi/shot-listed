import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { signUploadParts } from "@/lib/library";

const body = z.object({ partNumbers: z.array(z.number().int().positive()).min(1).max(100) });

/** Presigned URLs for a batch of parts of a multipart upload. */
export async function POST(req: Request, ctx: RouteContext<"/api/media/uploads/[id]/parts">) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut", "agent"]);
    const { id } = await ctx.params;
    const { partNumbers } = await readJson(req, body);
    return Response.json({ parts: await signUploadParts(id, partNumbers) });
  });
}
