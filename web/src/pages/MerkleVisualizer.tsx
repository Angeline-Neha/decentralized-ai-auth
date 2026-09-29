import { actionId, buildActionTree } from "@agentguard/shared/merkle";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchGrant, fetchProof } from "../lib/api";

export function MerkleVisualizerPage() {
  const [grantId, setGrantId] = useState(1);
  const [action, setAction] = useState("read_calendar");

  const grantQ = useQuery({
    queryKey: ["grant-merkle", grantId],
    queryFn: () => fetchGrant(grantId),
    refetchInterval: 5000,
  });

  const proofQ = useQuery({
    queryKey: ["proof", grantId, action],
    queryFn: () => fetchProof(grantId, action),
    enabled: !!grantQ.data?.manifest?.actions.includes(action),
  });

  const actions = useMemo(() => grantQ.data?.manifest?.actions ?? [], [grantQ.data]);
  const tree = useMemo(() => (actions.length ? buildActionTree(actions) : null), [actions]);
  const proofSet = useMemo(() => new Set(proofQ.data?.proofs[0]?.proof ?? []), [proofQ.data]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Merkle proof visualizer</h2>
        <p className="text-sm text-console-muted">Whitelist leaves → root; proof siblings light up for the selected action</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          Grant ID
          <input className="input ml-2 w-20" type="number" value={grantId} onChange={(e) => setGrantId(Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Action
          <select className="input ml-2" value={action} onChange={(e) => setAction(e.target.value)}>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!grantQ.data?.manifest && (
        <p className="text-sm text-amber-300">Upload manifest via Create grant or POST /grants/{grantId}/manifest</p>
      )}

      {tree && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="panel p-4">
            <div className="text-xs text-console-muted">On-chain root</div>
            <div className="mt-1 break-all font-mono text-xs text-emerald-300">{tree.root}</div>
            <ul className="mt-4 space-y-2">
              {actions.map((name) => {
                const leaf = actionId(name);
                const selected = name === action;
                return (
                  <li
                    key={name}
                    className={`rounded-lg border px-3 py-2 font-mono text-xs ${selected ? "border-emerald-500/60 bg-emerald-500/10" : "border-console-border"}`}
                  >
                    <div className="text-slate-200">{name}</div>
                    <div className="text-console-muted">{leaf.slice(0, 22)}…</div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="panel p-4">
            <h3 className="text-sm font-medium">Proof path (grant level 0)</h3>
            {proofQ.isLoading && <p className="text-sm text-console-muted">Loading proof…</p>}
            {proofQ.data && (
              <>
                <p className="mt-2 text-xs text-console-muted">{proofQ.data.proofs.length} level(s) in delegation chain</p>
                <ul className="mt-3 space-y-2">
                  {(proofQ.data.proofs[0]?.proof ?? []).map((hash) => (
                    <li
                      key={hash}
                      className={`rounded border px-2 py-1 font-mono text-xs ${proofSet.has(hash) ? "border-amber-400/50 bg-amber-500/10 text-amber-100" : "border-console-border"}`}
                    >
                      sibling {hash.slice(0, 18)}…
                    </li>
                  ))}
                </ul>
                <svg viewBox="0 0 320 200" className="mt-4 w-full max-w-sm text-emerald-400">
                  <text x="160" y="24" textAnchor="middle" className="fill-console-muted text-[10px]">
                    root
                  </text>
                  <rect x="120" y="32" width="80" height="28" rx="4" className="fill-emerald-500/20 stroke-emerald-500" />
                  <line x1="160" y1="60" x2="80" y2="100" className="stroke-console-border" />
                  <line x1="160" y1="60" x2="240" y2="100" className="stroke-console-border" />
                  <rect
                    x="40"
                    y="100"
                    width="80"
                    height="28"
                    rx="4"
                    className={action ? "fill-emerald-500/30 stroke-emerald-400" : "fill-console-panel stroke-console-border"}
                  />
                  <rect x="200" y="100" width="80" height="28" rx="4" className="fill-amber-500/15 stroke-amber-500/50" />
                  <text x="80" y="118" textAnchor="middle" className="fill-slate-200 text-[9px]">
                    leaf
                  </text>
                  <text x="240" y="118" textAnchor="middle" className="fill-amber-200 text-[9px]">
                    proof
                  </text>
                </svg>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
