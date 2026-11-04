import type { Metadata } from "next";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Inbox · ShotListed" };

export default function InboxPage() {
  return <InboxView />;
}
