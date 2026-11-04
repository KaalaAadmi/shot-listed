import type { Metadata } from "next";
import { IdeasList } from "./ideas-list";

export const metadata: Metadata = { title: "Ideas · ShotListed" };

export default function IdeasPage() {
  return <IdeasList />;
}
