import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { editBrief, makeBrief } from "@/lib/ideas";

export const maxDuration = 120;

/** Make the brief from the chat. */
export async function POST(req: Request, ctx: RouteContext<"/api/ideas/[id]/brief">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await makeBrief((await ctx.params).id);
    return new Response(null, { status: 204 });
  });
}

const body = z.object({ brief: z.unknown(), questions: z.array(z.string()).default([]) });

/** Save your edits to the brief (the fields are checked against the concept shape). */
export async function PUT(req: Request, ctx: RouteContext<"/api/ideas/[id]/brief">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const b = await readJson(req, body);
    await editBrief((await ctx.params).id, b.brief, b.questions);
    return new Response(null, { status: 204 });
  });
}
