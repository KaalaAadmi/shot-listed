import type { Metadata } from "next";
import { ShootList } from "./shoot-list";

export const metadata: Metadata = { title: "Shoot list · ShotListed" };

export default function ShootPage() {
  return <ShootList />;
}
