import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BlockChainView } from "../components/BlockChainView";
import { Empty, Notice, PageHeader } from "../components/ui";
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

  const status = !data ? (
    <span className="text-mute">Verifying…</span>
  ) : data.blocks.length === 0 && data.valid ? (
    <span className="text-mute">Genesis only</span>
  ) : data.valid ? (
    <span className="font-semibold text-ok">Valid · {data.blocks.length} blocks{data.lagging ? ", syncing" : ""}</span>
  ) : (
    <span className="animate-pulse font-semibold text-bad">Broken at block #{(data.brokenAt ?? 0) + 1}</span>
  );

  return (
    <div className="space-y-10">
      <PageHeader
        title="Audit chain"
        lead="Every recorded action is a block linked to the one before it. Edit any block to see how tampering is caught, and why the chain refuses new blocks until it is restored."
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={restore.isPending} onClick={() => restore.mutate()} title="Rebuild the off-chain copy from on-chain events">
              {restore.isPending ? "Restoring…" : "Restore from chain"}
            </button>
            <button type="button" className="btn-primary" disabled={verify.isFetching} onClick={() => void verify.refetch()}>
              {verify.isFetching ? "Verifying…" : "Re-verify"}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={reset.isPending}
              onClick={() => confirm("Reset demo: deploy a fresh contract, wipe state, seed Grant #1?") && reset.mutate()}
            >
              {reset.isPending ? "Resetting…" : "Reset demo"}
            </button>
          </>
        }
      />

      <dl className="grid gap-x-8 gap-y-5 border-y border-line py-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-mute">RPC endpoint</dt>
          <dd className="mt-0.5 font-mono">{health.data?.rpcUrl ?? "…"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-mute">Contract</dt>
          <dd className="mt-0.5 truncate font-mono" title={health.data?.contract}>{health.data?.contract ?? "Loading…"}</dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Chain id · status</dt>
          <dd className="mt-0.5 font-mono">
            {health.data?.chainId ?? "—"} · {health.data?.contractLive ? <span className="text-ok">live</span> : <span className="text-warn">offline</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-mute">Hash-chain check</dt>
          <dd className="mt-0.5 font-mono">{status}</dd>
          {data && !data.chainAvailable && <p className="mt-1 text-xs text-warn">On-chain record unreachable. Checking hash links only.</p>}
        </div>
      </dl>

      {error && <Notice tone="bad">{error}</Notice>}

      {data && !data.valid && (
        <Notice tone="bad">
          <b>Tampering detected. {data.tamperedCount} block{data.tamperedCount === 1 ? "" : "s"} failing verification.</b>{" "}
          {firstBad ? `Block #${firstBad.index + 1}: ${firstBad.reasons.join(" ")}` : data.missing.length ? "One or more blocks were deleted." : "The final hash differs from the contract's auditHead."}{" "}
          Red means the block's content differs from the on-chain record. Amber means the block is intact but the one before it changed, so its link no longer verifies.
        </Notice>
      )}

      <div>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ox-600">Blocks · scroll sideways</h2>
          <p className="font-mono text-xs text-mute">H(i) = keccak256(H(i-1) ‖ grant ‖ action ‖ amount ‖ params ‖ code ‖ height)</p>
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
          <Empty title="Loading chain…" />
        )}
        {data && data.blocks.length === 0 && (
          <p className="mt-2 text-sm text-mute">No action blocks yet. Use “Mine next blocks” (needs the agent on port 8000).</p>
        )}
      </div>

      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-semibold text-ox-600">Walk through a tamper demo</summary>
        <ol className="mt-4 max-w-[72ch] list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-mute">
          <li><b className="text-ink">Tamper</b> with a block (for example its amount). It turns red, a banner appears on every page, and the on-chain value is shown beside yours.</li>
          <li>Click <b className="text-ink">Mine next blocks</b>. The gateway answers 423 and nothing is appended.</li>
          <li><b className="text-ink">Re-mine</b> the block, as an attacker fixing its hash. It looks consistent, but the next block's link breaks and it still differs from the chain.</li>
          <li><b className="text-ink">Re-mine all after</b>. Every local hash now verifies, yet it is still caught, because the contract's <code className="mono-chip">auditHead</code> and events are the anchor.</li>
          <li><b className="text-ink">Restore from chain</b>. The copy is rebuilt from on-chain events, the banner clears, and mining works again.</li>
        </ol>
      </details>
    </div>
  );
}
