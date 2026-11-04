import type { Metadata } from "next";
import { FinalDetail } from "./final-detail";

export const metadata: Metadata = { title: "Captions · ShotListed" };

export default async function FinalPage({ params }: PageProps<"/finals/[id]">) {
  const { id } = await params;
  return <FinalDetail id={id} />;
}
