import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { listInspirations, share } from "@/lib/inspirations";

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ inspirations: await listInspirations() });
  });
}

const body = z
  .object({ url: z.string().max(500).optional(), assetId: z.string().uuid().optional(), note: z.string().max(1000).default("") })
  .refine((b) => !!b.url !== !!b.assetId, "Send either a link or an uploaded file");

/** The iOS Shortcut (or the Inbox) shares a reel; the host downloads and watches it in the background. */
export async function POST(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut"]);
    const { id, existing } = await share(await readJson(req, body));
    return Response.json({ id, existing }, { status: existing ? 200 : 202 });
  });
}
