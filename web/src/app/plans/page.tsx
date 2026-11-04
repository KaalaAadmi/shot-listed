import type { Metadata } from "next";
import { PlansList } from "./plans-list";

export const metadata: Metadata = { title: "Plans · ShotListed" };

export default function PlansPage() {
  return <PlansList />;
}
