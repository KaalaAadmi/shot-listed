import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listDuplicates } from "@/lib/library-match";

/** Pairs that need you ("open") and merges still inside their 7-day undo window ("waiting"). */
export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    const [open, waiting] = await Promise.all([listDuplicates("open"), listDuplicates("waiting")]);
    return Response.json({ open, waiting });
  });
}
