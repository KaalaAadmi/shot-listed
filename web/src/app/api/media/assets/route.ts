import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listAssets, usage } from "@/lib/library";

/** Library listing, newest first, with signed view URLs and storage used. */
export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const params = new URL(req.url).searchParams;
    const kind = params.get("kind");
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 48) || 48, 1), 100);
    const [page, used] = await Promise.all([
      listAssets({
        kind: kind === "photo" || kind === "video" ? kind : undefined,
        before: params.get("before") ?? undefined,
        limit,
      }),
      usage(),
    ]);
    return Response.json({ ...page, usage: used });
  });
}
