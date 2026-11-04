import { authorize } from "@/lib/auth";
import { handle } from "@/lib/http";
import { listPlans } from "@/lib/plans";

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json({ plans: await listPlans() });
  });
}
