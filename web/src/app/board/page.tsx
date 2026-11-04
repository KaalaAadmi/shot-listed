import type { Metadata } from "next";
import { Board } from "./board";

export const metadata: Metadata = { title: "Board · ShotListed" };

export default function BoardPage() {
  return <Board />;
}
