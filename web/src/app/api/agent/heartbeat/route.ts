import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { recordHeartbeat } from "@/lib/library";

const body = z.object({
  machine: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  photosCount: z.number().int().nonnegative().optional(),
  lastSyncAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * The Mac mini agent calls this every few minutes. The response tells it whether to
 * sync: only while Settings has the Mac selected as the library source.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await authorize(req, ["agent"]);
    return Response.json(await recordHeartbeat(await readJson(req, body)));
  });
}
