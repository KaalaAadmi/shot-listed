"use client";

import { Background, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import type { PlanView } from "@/lib/plan-rules.ts";

const COLOUR = { done: "var(--ok)", running: "var(--accent)", failed: "var(--bad)", needs_you: "var(--accent)", skipped: "var(--line)", waiting: "var(--line)" } as const;
const FROM = ["matching", "stock", "writing"] as const;

/** How the plan was made, one node per step. Tap a step to see what it did or why it failed. */
export function Pipeline({ plan, busy, onRetry }: { plan: PlanView; busy: boolean; onRetry: (from: (typeof FROM)[number]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const nodes = useMemo<Node[]>(
    () =>
      plan.steps.map((s, i) => ({
        id: String(i),
        position: { x: i * 190, y: 0 },
        data: { label: s.name },
        draggable: false,
        style: { border: `2px solid ${COLOUR[s.status]}`, borderRadius: 12, background: "var(--surface)", color: "var(--foreground)", fontSize: 13, width: 160 },
      })),
    [plan.steps],
  );
  const edges = useMemo<Edge[]>(() => plan.steps.slice(1).map((_, i) => ({ id: `e${i}`, source: String(i), target: String(i + 1) })), [plan.steps]);
  const step = open === null ? null : plan.steps[open];

  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 rounded-xl border border-line bg-surface">
        <ReactFlow nodes={nodes} edges={edges} fitView nodesConnectable={false} zoomOnScroll={false} panOnDrag={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => setOpen(Number(n.id))}>
          <Background />
        </ReactFlow>
      </div>
      {step && open !== null && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <p className="font-medium">{step.name}</p>
          <p className={step.error ? "text-bad" : "text-muted"}>{step.error ?? step.summary ?? step.status}</p>
          <button type="button" disabled={busy || plan.build === "building"} onClick={() => onRetry(FROM[open])} className="self-start rounded-lg border border-line px-3 py-2">
            Retry from here
          </button>
        </div>
      )}
    </div>
  );
}
