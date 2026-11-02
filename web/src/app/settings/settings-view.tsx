"use client";

import { useEffect, useState } from "react";
import type { IngestMode } from "@/lib/types";

type Agent = {
  machine: string;
  version: string;
  photosCount: number | null;
  lastSyncAt: string | null;
  lastSeenAt: string;
  online: boolean;
};

const OPTIONS: { value: IngestMode; title: string; body: string }[] = [
  {
    value: "phone-upload",
    title: "Upload from my phone",
    body: "Pick photos and videos in the Library screen. Everything is stored in your R2 bucket.",
  },
  {
    value: "mac-photos",
    title: "Sync from the Mac mini",
    body: "The Mac mini reads your iCloud Photos library and sends new items on its own. Phone uploads still work for Film it takes.",
  },
];

export function SettingsView() {
  const [mode, setMode] = useState<IngestMode | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetch("/api/settings"), fetch("/api/agent/status")]).then(async ([s, a]) => {
      if (s.ok) setMode(((await s.json()) as { ingestMode: IngestMode }).ingestMode);
      if (a.ok) setAgents(((await a.json()) as { agents: Agent[] }).agents);
    });
  }, []);

  const macOnline = agents.some((a) => a.online);

  async function choose(value: IngestMode) {
    if (value === mode) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingestMode: value }),
    });
    setSaving(false);
    if (res.ok) {
      setMode(value);
      setMessage(
        value === "mac-photos" && !macOnline
          ? "Saved. The Mac mini hasn't checked in yet, so nothing will sync until its agent is running."
          : "Saved.",
      );
    } else {
      setMessage("Couldn't save. Try again.");
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Choose where your library comes from. You can switch at any time; items already in the library stay.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3" disabled={saving || mode === null}>
        <legend className="mb-2 text-sm font-medium">Library source</legend>
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
              mode === o.value ? "border-accent bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <input
              type="radio"
              name="ingest"
              value={o.value}
              checked={mode === o.value}
              onChange={() => void choose(o.value)}
              className="mt-1 accent-[var(--accent)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">{o.title}</span>
              <span className="text-sm text-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {message && <p className="text-sm text-muted">{message}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Mac mini</h2>
        {agents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            No Mac has checked in. Once the agent is installed it will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {agents.map((a) => {
              const { online } = a;
              return (
                <li key={a.machine} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                  <span className={`h-2 w-2 rounded-full ${online ? "bg-ok" : "bg-line"}`} aria-hidden />
                  <span className="font-medium">{a.machine}</span>
                  <span className="text-muted">{online ? "Online" : "Offline"}</span>
                  <span className="text-muted">Agent {a.version}</span>
                  {a.photosCount !== null && <span className="text-muted">{a.photosCount} items in Photos</span>}
                  <span className="text-muted">
                    Last seen {new Date(a.lastSeenAt).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
