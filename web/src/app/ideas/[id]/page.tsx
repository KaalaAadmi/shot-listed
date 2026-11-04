import type { Metadata } from "next";
import { IdeaScreen } from "./idea-screen";

export const metadata: Metadata = { title: "Idea · ShotListed" };

export default async function IdeaPage({ params }: PageProps<"/ideas/[id]">) {
  const { id } = await params;
  return <IdeaScreen id={id} />;
}
