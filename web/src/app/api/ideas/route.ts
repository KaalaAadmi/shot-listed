import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createIdea, listIdeas, pasteBrief } from "@/lib/ideas";

export const maxDuration = 120;

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ ideas: await listIdeas() });
  });
}

const body = z.union([z.object({ text: z.string().trim().min(1).max(4000) }), z.object({ pasted: z.string().trim().min(1).max(20000) })]);

/** `{ text }` starts an idea chat; `{ pasted }` reads a brief from anywhere. */
export async function POST(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const b = await readJson(req, body);
    return Response.json({ id: "text" in b ? await createIdea(b.text) : await pasteBrief(b.pasted) }, { status: 201 });
  });
}
