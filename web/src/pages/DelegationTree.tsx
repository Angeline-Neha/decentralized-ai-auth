import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Link } from "react-router-dom";
import { fetchGrants } from "../lib/api";
import { ethFromWei, shortAddr, statusLabel } from "../lib/format";
import { BudgetBar, Empty, PageHeader } from "../components/ui";

export function DelegationTreePage() {
  const q = useQuery({ queryKey: ["grants"], queryFn: fetchGrants, refetchInterval: 3000 });
  const grants = q.data?.grants ?? [];

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (const g of grants) {
      const depth = g.depth ?? (g.parent_id ? 1 : 0);
      const budgetPct = g.total_budget === "0" ? 0 : Number((BigInt(g.spent) * 10000n) / BigInt(g.total_budget)) / 100;
      nodes.push({
        id: String(g.id),
        position: { x: 40 + depth * 260, y: 40 + g.id * 110 },
        data: {
          label: (
            <div className="border border-line border-l-4 border-l-ox-600 bg-card px-3 py-2.5 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink">Grant #{g.id}</span>
                <span className="text-[11px] text-mute">{statusLabel(g.status)}</span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-mute">{shortAddr(g.agent)}</div>
              <div className="mt-2"><BudgetBar pct={budgetPct} /></div>
              <div className="mt-1 font-mono text-[11px] text-mute">{ethFromWei(g.spent)} / {ethFromWei(g.total_budget)} ETH</div>
            </div>
          ),
        },
        style: { width: 200, border: "none", background: "transparent", padding: 0 },
      });
      if (g.parent_id && g.parent_id > 0) {
        edges.push({
          id: `e-${g.parent_id}-${g.id}`,
          source: String(g.parent_id),
          target: String(g.id),
          animated: true,
          style: { stroke: "#5A0E13", strokeWidth: 1.5 },
        });
      }
    }
    return { nodes, edges };
  }, [grants]);

  const hasChildren = grants.some((g) => g.parent_id && g.parent_id > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Delegation"
        lead="A grant can hand part of its authority to another agent, but never more than it holds itself. Arrows point from parent to child."
      />
      {grants.length === 0 ? (
        <Empty title="No grants yet" hint="Delegated grants appear here once at least one grant exists." action={<Link to="/create" className="btn-primary">Create a grant</Link>} />
      ) : (
        <>
          <div className="h-[520px] overflow-hidden border border-line bg-card">
            <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }} nodesConnectable={false}>
              <Background color="#DCD3D2" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {!hasChildren && <p className="text-sm text-mute">No delegated grants yet. Every grant here is a root grant.</p>}
        </>
      )}
    </div>
  );
}
