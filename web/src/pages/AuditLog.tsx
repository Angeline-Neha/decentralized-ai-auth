import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchEvents, verifyAudit } from "../lib/api";
import { StatusPill } from "../components/StatusPill";
import { CopyHash, Empty, Notice, PageHeader } from "../components/ui";
import { reasonText, shortHash, verdict } from "../lib/format";
import { useIntegrity } from "../hooks/useIntegrity";
import clsx from "clsx";

type Filter = "all" | "denied" | "allowed";

export function AuditLogPage() {
  const eventsQ = useQuery({ queryKey: ["events-audit"], queryFn: () => fetchEvents(80), refetchInterval: 6000 });
  const [verifyResult, setVerifyResult] = useState<Awaited<ReturnType<typeof verifyAudit>> | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const verify = useMutation({
    mutationFn: () => verifyAudit(),
    onSuccess: setVerifyResult,
  });

  const events = eventsQ.data?.events ?? [];
  const integrity = useIntegrity().data;
  const blockByIndex = new Map((integrity?.blocks ?? []).map((b) => [b.index, b]));

  const shown = useMemo(
    () => events.filter((e) => (filter === "all" ? true : filter === "denied" ? verdict(e.code).denied : !verdict(e.code).denied)),
    [events, filter],
  );
  const deniedCount = events.filter((e) => verdict(e.code).denied).length;

  const FILTERS: Array<[Filter, string, number]> = [
    ["all", "All", events.length],
    ["allowed", "Allowed", events.length - deniedCount],
    ["denied", "Denied", deniedCount],
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Audit log"
        lead="Every agent action, in order. Each entry's hash includes the one before it, so changing any past entry breaks every entry after it."
        actions={
          <button type="button" className="btn-primary" disabled={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? "Verifying…" : "Verify chain"}
          </button>
        }
      />

      {integrity && !integrity.valid && !verifyResult && (
        <Notice tone="bad">Chain broken at block #{(integrity.brokenAt ?? 0) + 1}. Rows marked below no longer match the on-chain record.</Notice>
      )}
      {verifyResult && (
        <Notice tone={verifyResult.valid ? "ok" : "bad"}>
          {verifyResult.valid
            ? `Chain valid. ${verifyResult.entriesChecked} entries match the on-chain head.`
            : `Chain broken at index ${verifyResult.brokenAt ?? "?"}. The database copy may have been tampered with.`}
          <span className="mt-1 block font-mono text-xs opacity-80">on-chain head {shortHash(verifyResult.onChainHead)}</span>
        </Notice>
      )}

      <div role="tablist" aria-label="Filter entries" className="flex gap-1 border-b border-line">
        {FILTERS.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={clsx("-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors", filter === key ? "border-ox-600 text-ox-600" : "border-transparent text-mute hover:text-ink")}
          >
            {label} <span className="ml-1 font-mono text-xs font-normal">{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title={events.length === 0 ? "No entries yet" : "Nothing matches this filter"} hint={events.length === 0 ? "Entries appear as soon as an agent tries an action." : "Switch to All to see every entry."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ox-600 text-xs text-ox-600">
                <th className="py-2 pr-4 font-semibold">Entry</th>
                <th className="py-2 pr-4 font-semibold">Grant</th>
                <th className="py-2 pr-4 font-semibold">Action</th>
                <th className="py-2 pr-4 font-semibold">Result</th>
                <th className="py-2 pr-4 font-semibold">Hash</th>
                <th className="py-2 font-semibold">Integrity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const blk = blockByIndex.get(e.index_num);
                const bad = !!blk && blk.status !== "ok";
                const v = verdict(e.code);
                return (
                  <tr key={e.index_num} className={clsx("border-b border-line align-top", bad ? "bg-[#FBE4E5]" : v.denied ? "bg-gradient-to-r from-[#FBE4E5]/70 to-transparent" : "hover:bg-card")}>
                    <td className="py-3 pr-4 font-mono">{e.index_num}</td>
                    <td className="py-3 pr-4">#{e.grant_id}</td>
                    <td className="py-3 pr-4 font-mono text-xs">{e.action_name ?? "—"}</td>
                    <td className="py-3 pr-4">
                      <StatusPill label={v.label} tone={v.tone} />
                      {v.denied && <p className="mt-1 max-w-[30ch] text-xs text-[#7A1219]">{reasonText(e.outcome)}</p>}
                    </td>
                    <td className="py-3 pr-4"><CopyHash value={e.head} label={shortHash(e.head)} /></td>
                    <td className="py-3 text-xs">
                      {!blk ? (
                        <span className="text-mute">—</span>
                      ) : blk.status === "ok" ? (
                        <span className="font-semibold text-ok">✓ verified</span>
                      ) : (
                        <span className="font-semibold text-bad" title={blk.reasons.join(" ")}>
                          {blk.status === "tampered" ? `Tampered (${blk.diffs.join(", ")})` : "Broken link"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
