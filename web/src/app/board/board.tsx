"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PlanStatus } from "@/lib/plan-rules.ts";
import type { PlanSummary } from "@/lib/plans";

export const COLUMNS: { status: PlanStatus; label: string }[] = [
  { status: "planned", label: "Planned" },
  { status: "filming", label: "Filming" },
  { status: "editing", label: "Editing" },
  { status: "ready", label: "Ready to post" },
  { status: "posted", label: "Posted" },
];

// ponytail: buttons, not drag and drop; add dragging if moving cards one step at a time gets tedious.
export function Board() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      fetch("/api/plans")
        .then((r) => (r.ok ? r.json() : { plans: [] }))
        .then((b: { plans: PlanSummary[] }) => setPlans(b.plans))
        .catch(() => setPlans([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function move(id: string, status: PlanStatus) {
    setError(null);
    const res = await fetch(`/api/plans/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't move it");
    await load();
  }

  if (!plans) return <p className="text-sm text-muted">Loading…</p>;
  const shown = plans.filter((p) => p.build === "ready");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
      {error && <p className="text-sm text-bad">{error}</p>}
      {shown.length === 0 && <p className="text-sm text-muted">Nothing here yet. Plans appear once they&apos;re built.</p>}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((col, i) => (
          <section key={col.status} className="flex min-w-60 flex-1 flex-col gap-2">
            <h2 className="text-sm font-medium text-muted">{col.label}</h2>
            {shown
              .filter((p) => p.status === col.status)
              .map((p) => (
                <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                  <Link href={`/plans/${p.id}`} className="text-sm font-medium">
                    {p.title}
                  </Link>
                  <span className="text-xs text-muted">{p.format}</span>
                  <div className="flex gap-2">
                    {i > 0 && (
                      <button type="button" onClick={() => move(p.id, COLUMNS[i - 1].status)} className="rounded-md border border-line px-2 py-1 text-xs">
                        ← {COLUMNS[i - 1].label}
                      </button>
                    )}
                    {i < COLUMNS.length - 1 && (
                      <button
                        type="button"
                        onClick={() => (COLUMNS[i + 1].status === "posted" ? router.push(`/plans/${p.id}#posted`) : move(p.id, COLUMNS[i + 1].status))}
                        className="rounded-md border border-line px-2 py-1 text-xs"
                      >
                        {COLUMNS[i + 1].label} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
