"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShootCard } from "@/lib/plans";

type Group = { where: string; cards: ShootCard[] };

/** Every open Film it card across plans, grouped by where it is filmed, so one trip covers several reels. */
export function ShootList() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  useEffect(() => {
    fetch("/api/shoot-list")
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((b: { groups: Group[] }) => setGroups(b.groups))
      .catch(() => setGroups([]));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shoot list</h1>
        <p className="text-sm text-muted">Shots still to film, grouped by place.</p>
      </div>
      {groups === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">Nothing to film right now.</p>
      ) : (
        groups.map((g) => (
          <section key={g.where} className="flex flex-col gap-2">
            <h2 className="font-medium">
              {g.where} <span className="text-sm font-normal text-muted">· {g.cards.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {g.cards.map((c) => (
                <li key={`${c.planId}-${c.shotId}`}>
                  <Link href={`/plans/${c.planId}`} className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-4 text-sm">
                    <span className="font-medium">{c.shot}</span>
                    <span className="text-muted">
                      {c.planTitle} · shot {c.n} · record {c.recordSeconds} s × {c.takes} · {c.framing}
                    </span>
                    {c.reshoot && <span className="text-bad">Reshoot: {c.reshoot}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
