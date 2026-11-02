import type { Metadata } from "next";
import { FinalsView } from "./finals-view";

export const metadata: Metadata = { title: "Captions · Reel Studio" };

export default function FinalsPage() {
  return <FinalsView />;
}
