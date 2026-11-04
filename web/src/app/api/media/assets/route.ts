import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { usage } from "@/lib/library";
import { listItems, searchItems, syncIfNeeded } from "@/lib/library-items";
import { countOpenDuplicates, mergeDueSoon } from "@/lib/library-match";

const query = z.object({
  kind: z.enum(["photo", "video"]).optional(),
  setting: z.string().max(40).optional(),
  q: z.string().trim().max(200).optional(),
  before: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

/** Library listing (newest first) or a plain-words search, with signed view URLs and storage used. */
export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const p = query.parse(Object.fromEntries(new URL(req.url).searchParams));
    await syncIfNeeded();
    mergeDueSoon();
    const [page, used, duplicates] = await Promise.all([
      p.q ? searchItems(p.q, p.limit) : listItems({ kind: p.kind, setting: p.setting, before: p.before, limit: p.limit }),
      usage(),
      countOpenDuplicates(),
    ]);
    return Response.json({ ...page, usage: used, duplicates });
  });
}
