import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { sendMessage } from "@/lib/ideas";

export const maxDuration = 120;

const body = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, ctx: RouteContext<"/api/ideas/[id]/messages">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await sendMessage((await ctx.params).id, (await readJson(req, body)).text);
    return new Response(null, { status: 204 });
  });
}
