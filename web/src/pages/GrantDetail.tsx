import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchGrant } from "../lib/api";
import { StatusPill } from "../components/StatusPill";
import { BudgetBar, CopyHash, Empty, Notice, PageHeader, Section } from "../components/ui";
import { ethFromWei, reasonText, shortAddr, statusLabel, statusTone, verdict } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { GrantStatus } from "@agentguard/shared/reasons";
import clsx from "clsx";

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
    onSuccess: () => {
      setConfirmRevoke(false);
      void qc.invalidateQueries({ queryKey: ["grant", grantId] });
    },
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

  if (q.isLoading) return <p className="text-mute">Loading grant…</p>;
  if (!q.data) return <Empty title="Grant not found" hint={`There is no grant #${id}.`} action={<Link to="/" className="btn-ghost">Back to dashboard</Link>} />;

  const g = q.data.grant;
  const budgetLeft = BigInt(g.total_budget) - BigInt(g.spent);
  const pct = g.total_budget === "0" ? 0 : Number((BigInt(g.spent) * 10000n) / BigInt(g.total_budget)) / 100;
  const strikes = q.data.onChain.strikes;
  const maxStrikes = g.max_strikes;
  const err = (revoke.error ?? unfreeze.error) as Error | null;

  return (
    <div className="space-y-12">
      <div>
        <Link to="/" className="mb-3 inline-block text-sm text-mute hover:text-ox-600">← Dashboard</Link>
        <PageHeader
          title={`Grant #${grantId}`}
          lead={`Agent ${shortAddr(g.agent)} may spend up to ${ethFromWei(g.total_budget)} ETH until ${new Date(g.expiry * 1000).toLocaleDateString()}.`}
          actions={<StatusPill label={statusLabel(g.status)} tone={statusTone(g.status)} />}
        />
      </div>

      <div className="grid gap-14 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section title="Budget" meta={`${pct.toFixed(pct < 10 ? 1 : 0)}% used`}>
            <div className="mt-5"><BudgetBar pct={pct} /></div>
            <p className="mt-3 flex flex-wrap gap-x-6 font-mono text-sm text-mute">
              <span><b className="font-medium text-ink">{ethFromWei(g.spent)}</b> spent</span>
              <span><b className="font-medium text-ink">{ethFromWei(budgetLeft.toString())}</b> left</span>
              <span><b className="font-medium text-ink">{ethFromWei(g.escrow)}</b> in escrow</span>
            </p>
          </Section>

          <Section title="Details">
            <dl className="divide-y divide-line text-sm">
              {[
                ["Agent", <span className="font-mono">{shortAddr(g.agent)}</span>],
                ["Owner", <span className="font-mono">{shortAddr(g.owner)}</span>],
                ["Nonce", <span className="font-mono">{q.data.onChain.nonce}</span>],
                ["Expires", new Date(g.expiry * 1000).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-6 py-3">
                  <dt className="text-mute">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {q.data.manifest && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-mute">Allowed actions</span>
                {q.data.manifest.actions.map((a) => <span key={a} className="mono-chip">{a}</span>)}
              </div>
            )}
          </Section>

          <Section title="Recent activity" meta="this grant">
            {q.data.recentAudit.length === 0 ? (
              <p className="py-6 text-sm text-mute">No actions recorded for this grant yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {q.data.recentAudit.map((e) => {
                  const v = verdict(e.code);
                  return (
                    <li key={e.index_num} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                      <span>
                        <span className="font-mono text-sm">{e.action_name ?? "unknown"}</span>
                        {v.denied && <span className="ml-3 text-sm text-[#7A1219]">{reasonText(e.outcome)}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <StatusPill label={v.label} tone={v.tone} />
                        <CopyHash value={e.head} label={`#${e.index_num}`} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-10">
          <Section title="Circuit breaker" meta={`${strikes} of ${maxStrikes} strikes`}>
            <div className="mt-5 flex gap-1.5" role="img" aria-label={`${strikes} of ${maxStrikes} strikes`}>
              {Array.from({ length: maxStrikes }).map((_, i) => (
                <span key={i} className={clsx("h-3 flex-1", i < strikes ? "bg-bad" : "bg-sunk")} />
              ))}
            </div>
            <p className="mt-3 text-sm text-mute">Each denied action adds a strike. At {maxStrikes}, the grant freezes until the owner unfreezes it.</p>
          </Section>

          <Section title="Owner controls">
            <div className="mt-4 space-y-3">
              {!address && <Notice tone="warn">Connect the owner wallet to use these controls.</Notice>}
              {err && <Notice tone="bad">{err.message}</Notice>}
              {g.status === GrantStatus.Frozen && (
                <button type="button" className="btn-ghost w-full" disabled={!address || unfreeze.isPending} onClick={() => unfreeze.mutate()}>
                  {unfreeze.isPending ? "Unfreezing…" : "Unfreeze grant"}
                </button>
              )}
              {!confirmRevoke ? (
                <button type="button" className="btn-danger w-full" disabled={!address || g.status === GrantStatus.Revoked} onClick={() => setConfirmRevoke(true)}>
                  {g.status === GrantStatus.Revoked ? "Grant revoked" : "Revoke grant"}
                </button>
              ) : (
                <div className="space-y-2 border border-bad bg-[#FBE4E5] p-4">
                  <p className="text-sm font-semibold text-[#7A1219]">Revoke this grant and refund the escrow? This cannot be undone.</p>
                  <button type="button" className="btn-danger w-full" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                    {revoke.isPending ? "Revoking…" : "Yes, revoke"}
                  </button>
                  <button type="button" className="btn-ghost w-full" onClick={() => setConfirmRevoke(false)}>Keep grant</button>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
