import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPending } from "../lib/api";
import { ethFromWei, shortAddr } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Empty, Notice, PageHeader } from "../components/ui";

export function ApprovalsPage() {
  const { getContract, address } = useWallet();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pending"], queryFn: fetchPending, refetchInterval: 5000 });

  const approve = useMutation({
    mutationFn: async (pendingId: number) => {
      const c = getContract();
      if (!c) throw new Error("Connect owner wallet");
      const tx = await c.approve(pendingId);
      await tx.wait();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pending"] }),
  });

  const reject = useMutation({
    mutationFn: async (pendingId: number) => {
      const c = getContract();
      if (!c) throw new Error("Connect owner wallet");
      const tx = await c.reject(pendingId);
      await tx.wait();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pending"] }),
  });

  const rows = q.data?.pending ?? [];
  const err = (approve.error ?? reject.error) as Error | null;
  const working = approve.isPending || reject.isPending;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Approvals"
        lead="Payments above a grant's approval threshold wait here until you co-sign them. Nothing moves until you decide."
      />

      {!address && <Notice tone="warn">Connect the grant owner's wallet to approve or reject.</Notice>}
      {err && <Notice tone="bad">{err.message}</Notice>}

      {rows.length === 0 ? (
        <Empty title="Nothing waiting" hint="When an agent asks to pay more than the approval threshold, the request will show up here." />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((p) => (
            <li key={p.pending_id} className="flex flex-wrap items-center justify-between gap-6 py-6">
              <div className="min-w-0">
                <p className="text-2xl font-extrabold tracking-tight">
                  {ethFromWei(p.amount)} <span className="text-base font-semibold text-mute">ETH</span>
                </p>
                <p className="mt-1 text-sm text-mute">
                  to <span className="font-mono text-ink">{shortAddr(p.payee)}</span> · Grant #{p.grant_id} · request #{p.pending_id}
                </p>
                <p className="mt-0.5 text-xs text-mute">Expires {new Date(p.expires_at * 1000).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" disabled={!address || working} onClick={() => approve.mutate(p.pending_id)}>
                  Approve
                </button>
                <button type="button" className="btn-ghost" disabled={!address || working} onClick={() => reject.mutate(p.pending_id)}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
