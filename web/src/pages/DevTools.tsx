import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BlockChainView } from "../components/BlockChainView";
import { INTEGRITY_KEY, useIntegrity } from "../hooks/useIntegrity";
import { devDeleteBlock, devHealth, devRemine, devResetDemo, devRestoreAudit, devTamperAudit, runScenario, type TamperField } from "../lib/api";

export function DevToolsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [mineNote, setMineNote] = useState<string | null>(null);

  const health = useQuery({ queryKey: ["dev-health"], queryFn: devHealth, refetchInterval: 5000 });
  const verify = useIntegrity();

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: INTEGRITY_KEY });
    void qc.invalidateQueries({ queryKey: ["events"] });
    void qc.invalidateQueries({ queryKey: ["events-audit"] });
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const tamper = useMutation({
    mutationFn: (v: { index: number; fields: Partial<Record<TamperField, string>> }) => devTamperAudit(v.index, v.fields),
    onSuccess: refresh,
    onError,
  });
  const remine = useMutation({ mutationFn: (v: { index: number; mode: "one" | "all" }) => devRemine(v.index, v.mode), onSuccess: refresh, onError });
  const del = useMutation({ mutationFn: (index: number) => devDeleteBlock(index), onSuccess: refresh, onError });
  const restore = useMutation({
    mutationFn: devRestoreAudit,
    onSuccess: () => {
      setMineNote(null);
      refresh();
    },
    onError,
  });
  const reset = useMutation({
    mutationFn: devResetDemo,
    onSuccess: () => {
      setMineNote(null);
      void health.refetch();
      void qc.invalidateQueries();
    },
    onError,
  });
  const mine = useMutation({
    mutationFn: () => runScenario("normal_day", 1),
    onSuccess: (res: { results?: Array<{ status?: number; outcome?: string }> }) => {
      const results = res?.results ?? [];
      const refused = results.filter((r) => r.status === 423).length;
      const appended = results.filter((r) => r.outcome && r.outcome !== "Error" && r.outcome !== "Refused").length;
      setMineNote(refused ? `${refused} block${refused > 1 ? "s" : ""} refused (chain tampered), ${appended} appended` : `${appended} block${appended === 1 ? "" : "s"} appended`);
      refresh();
    },
    onError: (e) => {
      setMineNote(null);
      onError(e);
    },
  });

  const data = verify.data;
  const busy = tamper.isPending || remine.isPending || del.isPending || restore.isPending;
  const firstBad = data?.blocks.find((b) => b.status !== "ok");

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-400">On-Chain Cryptographic Ledger</span>
            <h2 className="text-xl font-bold tracking-tight text-slate-100">Audit blockchain</h2>
          </div>
          <p className="mt-1 text-sm text-console-muted">
            Edit any block to tamper with it. Every page flags it, and the gateway refuses to add new blocks until the chain is restored.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost text-xs" disabled={restore.isPending} onClick={() => restore.mutate()} title="Rebuild the off-chain copy from on-chain events">
            {restore.isPending ? "Restoring…" : "🛡️ Restore from chain"}
          </button>
          <button type="button" className="btn-primary text-xs" disabled={verify.isFetching} onClick={() => void verify.refetch()}>
            {verify.isFetching ? "Verifying…" : "⚡ Re-verify"}
          </button>
          <button
            type="button"
            className="btn-danger text-xs"
            disabled={reset.isPending}
            onClick={() => confirm("Reset demo: deploy a fresh contract, wipe state, seed Grant #1?") && reset.mutate()}
          >
            {reset.isPending ? "Resetting…" : "🔄 Reset demo"}
          </button>
        </div>
      </div>

      <div className="panel grid gap-4 p-4 text-xs sm:grid-cols-4">
        <div>
          <div className="text-console-muted">RPC endpoint</div>
          <div className="mt-1 font-mono font-semibold text-slate-200">{health.data?.rpcUrl ?? "…"}</div>
        </div>
        <div className="min-w-0">
          <div className="text-console-muted">Contract</div>
          <div className="mt-1 truncate font-mono font-semibold text-emerald-300" title={health.data?.contract}>
            {health.data?.contract ?? "Loading…"}
          </div>
        </div>
        <div>
          <div className="text-console-muted">Chain id / status</div>
          <div className="mt-1 font-mono font-semibold text-slate-200">
            {health.data?.chainId ?? "—"} • {health.data?.contractLive ? "🟢 live" : "🟡 offline"}
          </div>
        </div>
        <div>
          <div className="text-console-muted">Hash-chain verification</div>
          <div className="mt-1 font-mono font-semibold">
            {!data ? (
              <span className="text-slate-400">Verifying…</span>
            ) : data.blocks.length === 0 && data.valid ? (
              <span className="text-slate-400">Genesis only</span>
            ) : data.valid ? (
              <span className="text-emerald-400">✅ VALID ({data.blocks.length} blocks{data.lagging ? ", syncing" : ""})</span>
            ) : (
              <span className="animate-pulse font-bold text-red-400">🚨 BROKEN at Block #{(data.brokenAt ?? 0) + 1}</span>
            )}
          </div>
          {data && !data.chainAvailable && <div className="mt-1 text-[10px] text-amber-300">On-chain record unreachable — checking hash links only.</div>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">{error}</div>}

      {data && !data.valid && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/40 p-4 text-xs text-red-200">
          <div className="font-bold text-red-300">🚨 Tampering detected — {data.tamperedCount} block(s) failing verification</div>
          <p className="mt-1 text-red-300/90">
            {firstBad ? `Block #${firstBad.index + 1}: ${firstBad.reasons.join(" ")}` : data.missing.length ? "One or more blocks were deleted." : "The final hash differs from the contract's auditHead."}{" "}
            <strong>Red</strong> = the block's content differs from the on-chain record. <strong>Amber</strong> = the block is intact, but the block before it changed, so its link
            no longer verifies.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-console-muted">Blockchain — scroll →</h3>
        <span className="font-mono text-[11px] text-console-muted"># = covered by hash · H(i) = keccak256(H(i-1) ‖ grant ‖ action ‖ amount ‖ params ‖ code ‖ height)</span>
      </div>

      {data ? (
        <BlockChainView
          data={data}
          busy={busy}
          mining={mine.isPending}
          mineNote={mineNote}
          onTamper={(index, fields) => tamper.mutate({ index, fields })}
          onRemine={(index, mode) => remine.mutate({ index, mode })}
          onDelete={(index) => del.mutate(index)}
          onMine={() => mine.mutate()}
        />
      ) : (
        <div className="panel p-8 text-center text-sm text-console-muted">Loading chain…</div>
      )}

      {data && data.blocks.length === 0 && (
        <p className="text-center text-xs text-console-muted">No action blocks yet — click “Mine next blocks” above (needs the agent on :8000) to append some.</p>
      )}

      <div className="panel space-y-2 p-4 text-xs text-console-muted">
        <h4 className="font-semibold text-slate-200">Try it (viva walkthrough)</h4>
        <ol className="list-decimal space-y-1 pl-5">
          <li><strong className="text-slate-300">Tamper</strong> a block (e.g. change its amount) → that block turns red, the banner appears on every page, and the on-chain value is shown next to yours.</li>
          <li>Click <strong className="text-slate-300">Mine next blocks</strong> → the gateway answers 423 and nothing is appended.</li>
          <li><strong className="text-slate-300">Re-mine</strong> the block (attacker fixes its hash) → it looks consistent, but the <em>next</em> block's link breaks and it still differs from the chain.</li>
          <li><strong className="text-slate-300">Re-mine all after</strong> → every local hash verifies, yet it is still caught because the contract's <code>auditHead</code> and events are the anchor.</li>
          <li><strong className="text-slate-300">Restore from chain</strong> → rebuilt from on-chain events, banner clears, mining works again.</li>
        </ol>
      </div>
    </div>
  );
}
