import type { Metadata } from "next";
import { DuplicatesView } from "./duplicates-view";

export const metadata: Metadata = { title: "Duplicates · ShotListed" };

export default function DuplicatesPage() {
  return <DuplicatesView />;
}
