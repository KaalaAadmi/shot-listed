import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { sendMessage } from "@/lib/plans";

export const maxDuration = 120;

const body = z.object({ text: z.string().trim().min(1).max(2000) });

/** One turn of the plan chat; the reply and any edits are saved on the plan. */
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/messages">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await sendMessage((await ctx.params).id, (await readJson(req, body)).text);
    return new Response(null, { status: 204 });
  });
}
