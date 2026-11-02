import type { Metadata } from "next";
import { CaptionSettings } from "./caption-settings";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings · Reel Studio" };

export default function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <SettingsView />
      <CaptionSettings />
    </div>
  );
}
