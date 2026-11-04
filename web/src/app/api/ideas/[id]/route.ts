import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { dropIdea, getIdea } from "@/lib/ideas";

export async function GET(req: Request, ctx: RouteContext<"/api/ideas/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json(await getIdea((await ctx.params).id));
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/ideas/[id]">) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    await dropIdea((await ctx.params).id);
    return new Response(null, { status: 204 });
  });
}
