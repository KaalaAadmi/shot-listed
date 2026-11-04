"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlanSummary } from "@/lib/plans";

export function PlansList() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  useEffect(() => {
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((b: { plans: PlanSummary[] }) => setPlans(b.plans))
      .catch(() => setPlans([]));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
      {plans === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted">No plans yet. Pick Make on a reel in the Inbox.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/plans/${p.id}`} className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-4">
                <span className="font-medium">{p.title}</span>
                <span className="text-xs text-muted">
                  {p.format} · {p.shots} shots{p.filmIt ? ` · ${p.filmIt} to film` : ""}{p.shootDay ? " · Shoot day" : ""} · {p.build === "ready" ? p.status : p.build}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
