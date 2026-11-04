import type { Metadata } from "next";
import { PlanScreen } from "./plan-screen";

export const metadata: Metadata = { title: "Reel plan · ShotListed" };

export default async function PlanPage({ params }: PageProps<"/plans/[id]">) {
  const { id } = await params;
  return <PlanScreen id={id} />;
}
