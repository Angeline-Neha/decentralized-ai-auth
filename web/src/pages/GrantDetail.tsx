import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchGrant } from "../lib/api";
import { StatusPill } from "../components/StatusPill";
import { ethFromWei, shortAddr, statusLabel, statusTone } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { GrantStatus } from "@agentguard/shared/reasons";

export function GrantDetailPage() {
  const { id } = useParams();
  const grantId = Number(id);
  const { getContract, address } = useWallet();
  const qc = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const q = useQuery({
    queryKey: ["grant", grantId],
    queryFn: () => fetchGrant(grantId),
    enabled: Number.isFinite(grantId),
    refetchInterval: 5000,
  });

  const revoke = useMutation({
    mutationFn: async () => {
      const c = getContract();
      if (!c) throw new Error("Connect owner wallet");
      const tx = await c.revoke(grantId);
      await tx.wait();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["grant", grantId] }),
  });

  const unfreeze = useMutation({
    mutationFn: async () => {
      const c = getContract();
      if (!c) throw new Error("Connect owner wallet");
      const tx = await c.unfreeze(grantId);
      await tx.wait();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["grant", grantId] }),
  });

  if (q.isLoading) return <p className="text-console-muted">Loading…</p>;
  if (!q.data) return <p className="text-red-400">Grant not found</p>;

  const g = q.data.grant;
  const budgetLeft = BigInt(g.total_budget) - BigInt(g.spent);
  const pct = g.total_budget === "0" ? 0 : Number((BigInt(g.spent) * 100n) / BigInt(g.total_budget));
  const strikes = q.data.onChain.strikes;
  const maxStrikes = g.max_strikes;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-xs text-console-muted hover:text-white">
            ← Dashboard
          </Link>
          <h2 className="text-xl font-semibold">Grant #{grantId}</h2>
        </div>
        <StatusPill label={statusLabel(g.status)} tone={statusTone(g.status)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-2">
          <h3 className="text-sm font-medium text-console-muted">Budget</h3>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-console-bg">
            <div className="h-full bg-emerald-500/80 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <p className="mt-2 font-mono text-sm">
            {ethFromWei(g.spent)} spent · {ethFromWei(budgetLeft.toString())} left · escrow {ethFromWei(g.escrow)} ETH
          </p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-console-muted">Agent</dt>
              <dd className="font-mono">{shortAddr(g.agent)}</dd>
            </div>
            <div>
              <dt className="text-console-muted">Owner</dt>
              <dd className="font-mono">{shortAddr(g.owner)}</dd>
            </div>
            <div>
              <dt className="text-console-muted">Nonce</dt>
              <dd className="font-mono">{q.data.onChain.nonce}</dd>
            </div>
            <div>
              <dt className="text-console-muted">Expiry</dt>
              <dd>{new Date(g.expiry * 1000).toLocaleString()}</dd>
            </div>
          </dl>
          {q.data.manifest && (
            <p className="mt-3 text-xs text-console-muted">Actions: {q.data.manifest.actions.join(", ")}</p>
          )}
        </div>

        <div className="panel flex flex-col gap-4 p-4">
          <div>
            <h3 className="text-sm font-medium">Circuit breaker</h3>
            <div className="mt-2 flex gap-2">
              {Array.from({ length: maxStrikes }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3 w-8 rounded-full ${i < strikes ? "bg-red-500" : "bg-console-border"}`}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-console-muted">
              {strikes} / {maxStrikes} strikes
            </p>
          </div>
          {g.status === GrantStatus.Frozen && (
            <button type="button" className="btn-ghost" disabled={!address} onClick={() => unfreeze.mutate()}>
              Unfreeze (owner)
            </button>
          )}
          {!confirmRevoke ? (
            <button type="button" className="btn-danger" disabled={!address || g.status === GrantStatus.Revoked} onClick={() => setConfirmRevoke(true)}>
              Kill switch
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-200">Revoke grant and refund escrow?</p>
              <button type="button" className="btn-danger w-full" onClick={() => revoke.mutate()}>
                Confirm revoke
              </button>
              <button type="button" className="btn-ghost w-full text-xs" onClick={() => setConfirmRevoke(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="panel p-4">
        <h3 className="mb-2 font-medium">Recent audit</h3>
        <ul className="divide-y divide-console-border text-sm">
          {q.data.recentAudit.map((e) => (
            <li key={e.index_num} className="flex justify-between py-2">
              <span>
                {e.action_name ?? "—"} · <StatusPill label={e.outcome ?? "?"} tone={e.code === 0 ? "ok" : "bad"} />
              </span>
              <span className="font-mono text-xs text-console-muted">#{e.index_num}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
