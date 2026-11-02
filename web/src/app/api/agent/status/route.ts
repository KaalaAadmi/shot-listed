import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listAgents } from "@/lib/library";

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

/** For the Settings screen: which Macs have checked in and when. */
export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const agents = await listAgents();
    const now = Date.now();
    return Response.json({
      agents: agents.map((a) => ({
        machine: a._id,
        version: a.version,
        photosCount: a.photosCount ?? null,
        lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
        lastSeenAt: a.lastSeenAt.toISOString(),
        // The agent checks in every 5 minutes; three missed check-ins means offline.
        online: now - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
      })),
    });
  });
}
