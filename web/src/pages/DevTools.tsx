import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  devHealth,
  devResetDemo,
  devRestoreAudit,
  devTamperAudit,
  verifyAudit,
  type VerifyResult,
} from "../lib/api";
import { formatEther } from "ethers";

function safeFormatAmount(rawAmount?: string | number): string {
  if (!rawAmount) return "0 ETH";
  const s = String(rawAmount).trim();
  try {
    if (s.includes(".")) {
      return `${s} ETH`;
    }
    const b = BigInt(s);
    if (b === 0n) return "0 ETH";
    return `${formatEther(b)} ETH`;
  } catch {
    return `${s} wei`;
  }
}

export function DevToolsPage() {
  const queryClient = useQueryClient();
  const [selectedTamperField, setSelectedTamperField] = useState<"amount" | "code" | "action_name" | "head">("amount");
  const [tamperValue, setTamperValue] = useState("0");
  const [tamperIndex, setTamperIndex] = useState<number | null>(null);

  const health = useQuery({
    queryKey: ["dev-health"],
    queryFn: devHealth,
    refetchInterval: 5000,
  });

  const verify = useQuery<VerifyResult>({
    queryKey: ["audit-verify"],
    queryFn: () => verifyAudit(),
    refetchInterval: 4000,
  });

  const tamperMutation = useMutation({
    mutationFn: ({
      index,
      field,
      value,
    }: {
      index: number;
      field: "amount" | "code" | "action_name" | "head";
      value: string;
    }) => devTamperAudit(index, field, value),
    onSuccess: () => {
      setTamperIndex(null);
      void verify.refetch();
      void queryClient.invalidateQueries({ queryKey: ["audit-verify"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => devRestoreAudit(),
    onSuccess: () => {
      void verify.refetch();
      void queryClient.invalidateQueries({ queryKey: ["audit-verify"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => devResetDemo(),
    onSuccess: () => {
      void verify.refetch();
      void health.refetch();
      void queryClient.invalidateQueries();
    },
  });

  const rows = verify.data?.rows ?? [];
  const brokenAt = verify.data?.brokenAt;
  const isChainValid = verify.data?.valid ?? true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30">
              On-Chain Cryptographic Ledger
            </span>
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Blockchain & Audit Hash-Chain Visualizer
            </h2>
          </div>
          <p className="mt-1 text-sm text-console-muted">
            Inspect immutable block links, simulate adversarial tampering, and test on-chain verification
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={restoreMutation.isPending}
            onClick={() => restoreMutation.mutate()}
            title="Restore off-chain database from on-chain event ground truth"
          >
            {restoreMutation.isPending ? "Restoring…" : "🛡️ Restore Ground Truth"}
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={verify.isFetching}
            onClick={() => void verify.refetch()}
          >
            {verify.isFetching ? "Verifying…" : "⚡ Re-Verify Hash Chain"}
          </button>
          <button
            type="button"
            className="btn-danger text-xs"
            disabled={resetMutation.isPending}
            onClick={() => {
              if (confirm("Reset demo: Deploy fresh contract, wipe state, and seed Grant #1?")) {
                resetMutation.mutate();
              }
            }}
          >
            {resetMutation.isPending ? "Resetting…" : "🔄 Reset Demo"}
          </button>
        </div>
      </div>

      {/* Network & Chain Status Banner */}
      <div className="panel grid gap-4 p-4 text-xs sm:grid-cols-4">
        <div>
          <div className="text-console-muted">RPC Node Endpoint</div>
          <div className="mt-1 font-mono font-semibold text-slate-200">{health.data?.rpcUrl ?? "http://127.0.0.1:7545"}</div>
        </div>
        <div>
          <div className="text-console-muted">Contract Address</div>
          <div className="mt-1 font-mono font-semibold text-emerald-300 truncate" title={health.data?.contract}>
            {health.data?.contract ?? "Loading…"}
          </div>
        </div>
        <div>
          <div className="text-console-muted">Chain ID / Status</div>
          <div className="mt-1 font-mono font-semibold text-slate-200">
            {health.data?.chainId ?? 1337} • {health.data?.contractLive ? "🟢 Contract Live" : "🟡 Offline"}
          </div>
        </div>
        <div>
          <div className="text-console-muted">Hash-Chain Verification</div>
          <div className="mt-1 font-mono font-semibold">
            {rows.length === 0 ? (
              <span className="text-slate-400">0 Action Blocks (Genesis only)</span>
            ) : isChainValid ? (
              <span className="text-emerald-400">✅ VALID ({rows.length} Blocks Verified)</span>
            ) : (
              <span className="text-red-400 font-bold animate-pulse">
                🚨 BROKEN at Block #{(brokenAt ?? 0) + 1}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Verification Status Alert */}
      {rows.length > 0 && !isChainValid && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/40 p-4 text-xs text-red-200">
          <div className="flex items-center gap-2 font-bold text-red-300">
            <span className="text-base">🚨</span>
            CRYPTOGRAPHIC HASH MISMATCH DETECTED
          </div>
          <p className="mt-1 text-red-300/90">
            Block #{(brokenAt ?? 0) + 1} contains altered state data. The computed keccak256 hash does not match the
            on-chain immutable root. Subsequent blocks cannot be appended to a compromised chain state.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-red-500/30 px-2.5 py-1 font-semibold text-red-100 hover:bg-red-500/50 border border-red-500/40"
              onClick={() => restoreMutation.mutate()}
            >
              🛡️ Restore SQLite from On-Chain Ground Truth
            </button>
          </div>
        </div>
      )}

      {/* Blockchain Blocks Flow */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-console-muted">
            Blockchain & State Hash-Chain Sequence
          </h3>
          <span className="text-xs text-console-muted font-mono">
            H(i) = keccak256(H(i-1) || grantId || actionId || amount || code || blockNumber)
          </span>
        </div>

        <div className="space-y-4">
          {/* Genesis Block #0 */}
          <div className="panel border-l-4 border-l-cyan-500 p-4 transition">
            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-xs font-bold text-cyan-300 border border-cyan-500/40">
                  Block #0
                </span>
                <span className="font-semibold text-slate-200">Genesis State Anchor</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">IMMUTABLE</span>
              </div>
              <div className="text-xs font-mono text-console-muted">Block Height: #0 • Nonce: 0</div>
            </div>

            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 md:grid-cols-3">
              <div className="rounded bg-black/40 p-2 border border-console-border">
                <div className="text-[10px] uppercase text-console-muted">Initial State Head (H₀)</div>
                <div className="mt-0.5 font-mono text-[11px] text-cyan-300 break-all">
                  0x0000000000000000000000000000000000000000000000000000000000000000
                </div>
              </div>
              <div className="rounded bg-black/40 p-2 border border-console-border">
                <div className="text-[10px] uppercase text-console-muted">Protocol Initializer</div>
                <div className="mt-0.5 text-[11px] text-slate-300">Contract Construction & Grant Initializer</div>
              </div>
              <div className="rounded bg-black/40 p-2 border border-console-border">
                <div className="text-[10px] uppercase text-console-muted">Chain Status</div>
                <div className="mt-0.5 text-[11px] text-emerald-400 font-semibold">🔗 Genesis Anchor Verified</div>
              </div>
            </div>
          </div>

          {/* Subsequent Action Blocks */}
          {rows.map((row, idx) => {
            const isCorrupted = brokenAt !== null && brokenAt !== undefined && idx >= brokenAt;
            const isDirectBrokenPoint = brokenAt === idx;
            const formattedAmount = safeFormatAmount(row.amount);

            return (
              <div key={row.index} className="space-y-2">
                {/* Chain Link Connector */}
                <div className="flex items-center justify-center py-1">
                  <div
                    className={`flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-mono border ${
                      isCorrupted
                        ? "border-red-500/60 bg-red-950/60 text-red-300 animate-pulse"
                        : "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                    }`}
                  >
                    {isCorrupted ? (
                      <>
                        <span>⚡</span>
                        <span>HASH MISMATCH: Previous state does not yield valid Head</span>
                      </>
                    ) : (
                      <>
                        <span>🔗</span>
                        <span>Cryptographic Hash Link Validated</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Block Card */}
                <div
                  className={`panel p-4 transition ${
                    isCorrupted
                      ? "border-l-4 border-l-red-500 border-red-500/40 bg-red-950/20"
                      : "border-l-4 border-l-emerald-500 border-console-border"
                  }`}
                >
                  <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-xs font-bold border ${
                          isCorrupted
                            ? "bg-red-500/20 text-red-300 border-red-500/40"
                            : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        }`}
                      >
                        Block #{idx + 1}
                      </span>
                      <span className="font-semibold text-slate-200">
                        Action:{" "}
                        <span className="font-mono text-emerald-300">
                          {row.actionName ?? (row.actionId ? `${row.actionId.slice(0, 10)}…` : "unnamed")}
                        </span>
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          row.code === 0
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {row.outcome ?? (row.code === 0 ? "Success" : `Code ${row.code}`)}
                      </span>
                      {isDirectBrokenPoint && (
                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase animate-bounce">
                          Tampered Block
                        </span>
                      )}
                    </div>

                    {/* Tamper Button */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTamperIndex(tamperIndex === row.index ? null : row.index)}
                        className={`rounded px-2 py-1 text-xs font-semibold transition border ${
                          isCorrupted
                            ? "border-red-500/40 bg-red-500/20 text-red-200 hover:bg-red-500/30"
                            : "border-slate-700 bg-slate-800 text-slate-300 hover:border-amber-500/50 hover:text-amber-200"
                        }`}
                      >
                        ✏️ {tamperIndex === row.index ? "Cancel" : "Tamper Data"}
                      </button>
                    </div>
                  </div>

                  {/* Tamper Interactive Box */}
                  {tamperIndex === row.index && (
                    <div className="mt-3 rounded-lg border border-amber-500/50 bg-black/60 p-3 text-xs space-y-3">
                      <div className="font-semibold text-amber-300">
                        Simulate Adversarial Attack: Alter Block #{idx + 1} Off-Chain Record
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label>
                          <span className="text-[10px] text-console-muted">Field to Corrupt</span>
                          <select
                            className="input mt-1 w-full text-xs"
                            value={selectedTamperField}
                            onChange={(e) => setSelectedTamperField(e.target.value as any)}
                          >
                            <option value="amount">Amount (wei)</option>
                            <option value="code">Outcome Code (0 = Success)</option>
                            <option value="action_name">Action Name</option>
                            <option value="head">State Hash Head</option>
                          </select>
                        </label>

                        <label className="sm:col-span-2">
                          <span className="text-[10px] text-console-muted">Corrupted Value</span>
                          <input
                            type="text"
                            className="input mt-1 w-full font-mono text-xs"
                            value={tamperValue}
                            onChange={(e) => setTamperValue(e.target.value)}
                            placeholder="e.g. 0, 999999999999999999, transfer_funds"
                          />
                        </label>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-danger text-xs py-1"
                          disabled={tamperMutation.isPending}
                          onClick={() =>
                            tamperMutation.mutate({
                              index: row.index,
                              field: selectedTamperField,
                              value: tamperValue,
                            })
                          }
                        >
                          {tamperMutation.isPending ? "Corrupting…" : "🚨 Apply Malicious Tamper"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs py-1"
                          onClick={() => setTamperIndex(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Block Metadata Grid */}
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 md:grid-cols-4">
                    <div className="rounded bg-black/30 p-2 border border-console-border">
                      <div className="text-[10px] uppercase text-console-muted">Grant & Nonce</div>
                      <div className="mt-0.5 font-mono text-slate-200">
                        Grant #{row.grantId} • Seq #{row.index}
                      </div>
                    </div>
                    <div className="rounded bg-black/30 p-2 border border-console-border">
                      <div className="text-[10px] uppercase text-console-muted">Amount Executed</div>
                      <div className="mt-0.5 font-mono text-emerald-300">{formattedAmount}</div>
                    </div>
                    <div className="rounded bg-black/30 p-2 border border-console-border">
                      <div className="text-[10px] uppercase text-console-muted">Block Height</div>
                      <div className="mt-0.5 font-mono text-slate-300">#{row.blockNumber}</div>
                    </div>
                    <div className="rounded bg-black/30 p-2 border border-console-border min-w-0">
                      <div className="text-[10px] uppercase text-console-muted">Tx Hash</div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-400 truncate" title={row.txHash}>
                        {row.txHash ? `${row.txHash.slice(0, 14)}…` : "—"}
                      </div>
                    </div>
                  </div>

                  {/* State Head Comparison */}
                  <div className="mt-2 rounded bg-black/40 p-2 border border-console-border min-w-0">
                    <div className="flex items-center justify-between text-[10px] uppercase text-console-muted">
                      <span>State Hash Head (H_{idx + 1})</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        keccak256(H_{idx} || Grant || Action || Amount || Code || Block)
                      </span>
                    </div>
                    <div
                      className={`mt-1 font-mono text-[11px] break-all leading-tight ${
                        isCorrupted ? "text-red-300 line-through decoration-red-500" : "text-emerald-400"
                      }`}
                    >
                      {row.head}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty State when no actions yet */}
          {rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-console-border p-8 text-center">
              <div className="mx-auto max-w-sm text-center">
                <div className="text-2xl">⛓️</div>
                <h4 className="mt-2 font-semibold text-slate-200">No Action Blocks Recorded Yet</h4>
                <p className="mt-1 text-xs text-console-muted">
                  Head over to <strong className="text-slate-200">Red Team</strong> and execute a scenario (e.g.{" "}
                  <em>Normal Day</em> or <em>Prompt Injection</em>). Each on-chain policy evaluation will append a new
                  cryptographically linked block here in real-time!
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Academic / Viva Context Footer */}
      <div className="panel p-5 text-xs text-console-muted space-y-3">
        <h4 className="font-semibold text-slate-200">Academic & Viva Explanation: Why Hash-Chaining Matters</h4>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <strong className="text-slate-300">1. Tamper-Evidence:</strong>
            <p className="mt-1">
              Every audit entry incorporates the hash of the preceding entry. If an attacker modifies an off-chain
              database row (e.g. turning a strike into a success), the computed head diverges from the contract's on-chain
              head.
            </p>
          </div>
          <div>
            <strong className="text-slate-300">2. Constant On-Chain Overhead:</strong>
            <p className="mt-1">
              The smart contract only maintains a single 32-byte storage slot for <code className="text-slate-300">auditHead</code>.
              Gas is minimal because the full logs are indexed off-chain and verified on demand.
            </p>
          </div>
          <div>
            <strong className="text-slate-300">3. Deterministic Verification:</strong>
            <p className="mt-1">
              Any auditor can independently re-execute the keccak256 chain from Genesis (H₀) to the current block to prove
              mathematically that zero logs have been deleted or altered.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
