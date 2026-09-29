import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { fetchGrants } from "../lib/api";
import { ethFromWei, shortAddr, statusLabel } from "../lib/format";

export function DelegationTreePage() {
  const q = useQuery({ queryKey: ["grants"], queryFn: fetchGrants, refetchInterval: 3000 });
  const grants = q.data?.grants ?? [];

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (const g of grants) {
      const depth = g.depth ?? (g.parent_id ? 1 : 0);
      const budgetPct =
        g.total_budget === "0" ? 0 : Number((BigInt(g.spent) * 100n) / BigInt(g.total_budget));
      nodes.push({
        id: String(g.id),
        position: { x: 40 + depth * 240, y: 40 + g.id * 90 },
        data: {
          label: (
            <div className="rounded-lg border border-console-border bg-console-panel px-3 py-2 text-left text-xs shadow-lg">
              <div className="font-semibold text-emerald-300">Grant #{g.id}</div>
              <div className="text-console-muted">Agent {shortAddr(g.agent)}</div>
              <div>{statusLabel(g.status)}</div>
              <div className="mt-1 h-1.5 w-32 overflow-hidden rounded bg-console-bg">
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(budgetPct, 100)}%` }} />
              </div>
              <div className="font-mono text-[10px]">
                {ethFromWei(g.spent)} / {ethFromWei(g.total_budget)} ETH
              </div>
            </div>
          ),
        },
        style: { width: 180, border: "none", background: "transparent" },
      });
      if (g.parent_id && g.parent_id > 0) {
        edges.push({
          id: `e-${g.parent_id}-${g.id}`,
          source: String(g.parent_id),
          target: String(g.id),
          animated: true,
          style: { stroke: "#22c55e88" },
        });
      }
    }
    return { nodes, edges };
  }, [grants]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Delegation tree</h2>
        <p className="text-sm text-console-muted">Child grants must be narrower than their parent (child ⊆ parent)</p>
      </div>
      {grants.length === 0 ? (
        <p className="text-console-muted">No grants indexed yet.</p>
      ) : (
        <div className="panel h-[520px] overflow-hidden">
          <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
            <Background color="#2d3a4f" gap={16} />
            <Controls />
            <MiniMap nodeColor="#22c55e" maskColor="#0f141980" />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
