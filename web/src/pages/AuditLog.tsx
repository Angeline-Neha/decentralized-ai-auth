import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchEvents, verifyAudit } from "../lib/api";
import { StatusPill } from "../components/StatusPill";
import { copy, shortHash } from "../lib/format";
import { useIntegrity } from "../hooks/useIntegrity";

export function AuditLogPage() {
  const eventsQ = useQuery({ queryKey: ["events-audit"], queryFn: () => fetchEvents(80), refetchInterval: 6000 });
  const [verifyResult, setVerifyResult] = useState<Awaited<ReturnType<typeof verifyAudit>> | null>(null);

  const verify = useMutation({
    mutationFn: () => verifyAudit(),
    onSuccess: setVerifyResult,
  });

  const events = eventsQ.data?.events ?? [];
  const integrity = useIntegrity().data;
  const blockByIndex = new Map((integrity?.blocks ?? []).map((b) => [b.index, b]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Audit log</h2>
          <p className="text-sm text-console-muted">Tamper-evident hash chain (indexed)</p>
        </div>
        <button type="button" className="btn-primary" disabled={verify.isPending} onClick={() => verify.mutate()}>
          {verify.isPending ? "Verifying…" : "Verify chain"}
        </button>
      </div>

      {integrity && !integrity.valid && !verifyResult && (
        <div className="panel border-red-500/40 p-4 text-sm text-red-300">
          Chain broken at Block #{(integrity.brokenAt ?? 0) + 1}. The rows marked below no longer match the on-chain record.
        </div>
      )}

      {verifyResult && (
        <div
          className={`panel p-4 text-sm ${verifyResult.valid ? "border-emerald-500/40" : "border-red-500/40"}`}
        >
          {verifyResult.valid ? (
            <p className="text-emerald-300">Chain valid — {verifyResult.entriesChecked} entries match on-chain head.</p>
          ) : (
            <p className="text-red-300">
              Chain broken at index {verifyResult.brokenAt ?? "?"} — DB may have been tampered (try POST /dev/tamper-audit).
            </p>
          )}
          <p className="mt-2 font-mono text-xs text-console-muted">head: {shortHash(verifyResult.onChainHead)}</p>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-console-border text-xs uppercase text-console-muted">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Grant</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Head</th>
              <th className="px-4 py-3">Integrity</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const blk = blockByIndex.get(e.index_num);
              const bad = !!blk && blk.status !== "ok";
              return (
              <tr key={e.index_num} className={`border-b border-console-border/50 ${bad ? "bg-red-950/30" : "hover:bg-white/[0.02]"}`}>
                <td className="px-4 py-2 font-mono">{e.index_num}</td>
                <td className="px-4 py-2">{e.grant_id}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.action_name ?? "—"}</td>
                <td className="px-4 py-2">
                  <StatusPill
                    label={e.outcome ?? "?"}
                    tone={e.code === 0 || e.code >= 100 ? "ok" : "bad"}
                  />
                </td>
                <td className="px-4 py-2">
                  <button type="button" className="font-mono text-xs text-emerald-400 hover:underline" onClick={() => copy(e.head)}>
                    {shortHash(e.head)}
                  </button>
                </td>
                <td className="px-4 py-2 text-xs">
                  {!blk ? (
                    <span className="text-console-muted">—</span>
                  ) : blk.status === "ok" ? (
                    <span className="text-emerald-400">✓ verified</span>
                  ) : (
                    <span className="font-semibold text-red-300" title={blk.reasons.join(" ")}>
                      {blk.status === "tampered" ? `⚠ TAMPERED (${blk.diffs.join(", ")})` : "⛓ broken link"}
                    </span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
