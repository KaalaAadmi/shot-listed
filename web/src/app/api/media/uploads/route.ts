import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createUpload } from "@/lib/library";
import { CONTENT_HASH_PATTERN } from "@/lib/media/policy";

const body = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().max(100).optional(),
  size: z.number().int().positive(),
  /** SHA-256 of the file's bytes, lowercase hex. How duplicates and resumes are found. */
  contentHash: z.string().regex(CONTENT_HASH_PATTERN, "contentHash must be a SHA-256 hex digest"),
  lastModified: z.number().int().nonnegative().optional(),
  takenAt: z.string().datetime({ offset: true }).optional(),
  externalId: z.string().min(1).max(200).optional(),
  purpose: z.enum(["library", "final-cut"]).optional(),
});

/**
 * Start an upload. Small files get one presigned PUT URL; large videos get a multipart
 * plan and ask for part URLs next. The same bytes already stored come back as `duplicate`;
 * an unfinished upload of the same file comes back as `resume` with the parts R2 has.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const caller = await authorize(req, ["owner", "shortcut", "agent"]);
    const input = await readJson(req, body);
    const origin = caller === "agent" ? "mac-photos" : caller === "shortcut" ? "shortcut" : "phone-upload";
    const result = await createUpload({ ...input, origin });
    return Response.json(result, { status: result.mode === "duplicate" ? 200 : 201 });
  });
}
