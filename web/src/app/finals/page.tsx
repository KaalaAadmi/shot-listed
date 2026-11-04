import type { Metadata } from "next";
import { FinalsView } from "./finals-view";

export const metadata: Metadata = { title: "Captions · ShotListed" };

export default function FinalsPage() {
  return <FinalsView />;
}
