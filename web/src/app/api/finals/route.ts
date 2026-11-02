import { after } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { createFinal, listFinals, prepareRun, runFrom } from "@/lib/finals";
import { handle, readJson } from "@/lib/http";

// Watching a reel and writing captions takes 30–90 seconds; this is Vercel Hobby's ceiling.
export const maxDuration = 300;

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ finals: await listFinals() });
  });
}

const body = z.object({
  assetId: z.string().uuid(),
  notes: z.string().max(2000).default(""),
});

/** Registers an uploaded final cut and starts the description and captions in the background. */
export async function POST(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner", "shortcut"]);
    const { assetId, notes } = await readJson(req, body);
    const { id, existing } = await createFinal(assetId, notes);
    if (!existing) {
      const start = await prepareRun(id);
      after(() => runFrom(id, start));
    }
    return Response.json({ id, existing }, { status: existing ? 200 : 202 });
  });
}
