import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPending } from "../lib/api";
import { ethFromWei, shortAddr } from "../lib/format";
import { useWallet } from "../lib/wallet";

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Approval queue</h2>
        <p className="text-sm text-console-muted">High-value intents waiting for owner co-sign</p>
      </div>
      {!address && <p className="text-sm text-amber-300">Connect wallet as grant owner to approve or reject.</p>}
      {rows.length === 0 ? (
        <div className="panel p-8 text-center text-console-muted">No pending approvals</div>
      ) : (
        <div className="grid gap-4">
          {rows.map((p) => (
            <div key={p.pending_id} className="panel flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <div className="font-medium">Pending #{p.pending_id}</div>
                <div className="text-sm text-console-muted">
                  Grant {p.grant_id} · {ethFromWei(p.amount)} ETH → {shortAddr(p.payee)}
                </div>
                <div className="text-xs text-console-muted">Expires {new Date(p.expires_at * 1000).toLocaleString()}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" disabled={!address} onClick={() => approve.mutate(p.pending_id)}>
                  Approve
                </button>
                <button type="button" className="btn-ghost" disabled={!address} onClick={() => reject.mutate(p.pending_id)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
