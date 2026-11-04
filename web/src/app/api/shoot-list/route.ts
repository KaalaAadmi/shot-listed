import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { shootList } from "@/lib/plans";

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ groups: await shootList() });
  });
}
