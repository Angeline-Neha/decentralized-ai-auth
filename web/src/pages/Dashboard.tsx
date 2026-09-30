import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchEvents, fetchGrants } from "../lib/api";
import { useEventStream } from "../hooks/useEventStream";
import { ethFromWei, reasonText, shortAddr, shortHash, statusLabel, verdict } from "../lib/format";
import { GrantStatus } from "@agentguard/shared/reasons";
import { BudgetBar, CopyHash, Empty, PageHeader, Section } from "../components/ui";
import { StatusPill } from "../components/StatusPill";
import { statusTone } from "../lib/format";
import clsx from "clsx";

export function DashboardPage() {
  const qc = useQueryClient();
  const grantsQ = useQuery({ queryKey: ["grants"], queryFn: fetchGrants, refetchInterval: 3000 });
  const eventsQ = useQuery({ queryKey: ["events"], queryFn: () => fetchEvents(100), refetchInterval: 3000 });
  const live = useEventStream(15);

  // A new SSE item means the ledger is stale: refetch now instead of waiting for the poll.
  useEffect(() => {
    if (live.length) void qc.invalidateQueries({ queryKey: ["events"] });
  }, [live.length, qc]);

  const grants = grantsQ.data?.grants ?? [];
  const events = eventsQ.data?.events ?? [];
  const active = grants.filter((g) => g.status === GrantStatus.Active).length;
  const frozen = grants.filter((g) => g.status === GrantStatus.Frozen).length;
  const denied = events.filter((e) => verdict(e.code).denied).length;
  const spent = grants.reduce((s, g) => s + BigInt(g.spent), 0n);
  const spentEth = (Number(spent) / 1e18).toFixed(3);

  const headline =
    events.length === 0
      ? "No agent activity yet."
      : denied > 0
        ? `${denied} action${denied === 1 ? " was" : "s were"} blocked.${spent === 0n ? " Nothing left the budget." : ` ${spentEth} ETH spent so far.`}`
        : "Every action so far stayed inside policy.";

  const lead = `${active} active grant${active === 1 ? "" : "s"}, ${frozen} frozen. ${events.length} action${events.length === 1 ? "" : "s"} recorded in the audit chain.`;
  const recent = events.slice(0, 8);

  return (
    <div className="space-y-12">
      <PageHeader title={headline} lead={lead} />

      <div className="grid gap-14 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section
          title="Action ledger"
          meta={
            <>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ok align-middle" />
              live · newest first
            </>
          }
        >
          {recent.length === 0 ? (
            <div className="mt-4">
              <Empty title="Nothing recorded yet" hint="Run a scenario on the Red team page and each agent action will appear here, linked to the one before it." action={<Link to="/redteam" className="btn-primary">Open red team</Link>} />
            </div>
          ) : (
            <ol className="relative">
              <span aria-hidden className="absolute bottom-8 left-[11px] top-8 w-0.5 origin-top animate-draw bg-line" />
              {recent.map((e, i) => {
                const v = verdict(e.code);
                const prev = events.find((x) => x.index_num === e.index_num - 1) ?? (i === recent.length - 1 ? undefined : recent[i + 1]);
                const why = v.denied ? reasonText(e.outcome) : null;
                return (
                  <li key={e.index_num} className={clsx("relative border-b border-line py-5 pl-11 last:border-0", v.denied && "-ml-3 bg-gradient-to-r from-[#FBE4E5] to-transparent pl-14", i === 0 && "animate-enter")}>
                    <span
                      className={clsx(
                        "absolute top-6 h-4 w-4 border-2",
                        v.denied ? "left-4 rounded-sm border-bad bg-bad" : "left-1 rounded-full border-ok bg-paper",
                      )}
                    />
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-mono text-base font-medium">{e.action_name ?? "unknown action"}</span>
                      <StatusPill label={v.label} tone={v.tone} />
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-mute">
                      <Link to={`/grants/${e.grant_id}`} className="hover:text-ox-600 hover:underline">Grant #{e.grant_id}</Link>
                      <span>{ethFromWei(e.amount)} ETH</span>
                      <span>entry #{e.index_num}</span>
                    </p>
                    {why && <p className="mt-2 text-sm font-medium text-[#7A1219]">{why}</p>}
                    <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-mute">
                      <span>hash <CopyHash value={e.head} label={shortHash(e.head)} /></span>
                      <span>prev {prev ? <CopyHash value={prev.head} label={shortHash(prev.head)} /> : e.index_num === 0 ? "genesis" : "…"}</span>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          {events.length > recent.length && (
            <Link to="/audit" className="mt-3 inline-block text-sm font-semibold text-ox-600 hover:underline">
              See all {events.length} entries in the audit log
            </Link>
          )}
        </Section>

        <div className="space-y-10">
          <Section title="Grants" meta={`${active} active`}>
            {grants.length === 0 ? (
              <div className="mt-4">
                <Empty title="No grants yet" hint="A grant says what an agent may do and how much it may spend." action={<Link to="/create" className="btn-primary">Create a grant</Link>} />
              </div>
            ) : (
              <ul>
                {grants.map((g) => {
                  const pct = g.total_budget === "0" ? 0 : Number((BigInt(g.spent) * 10000n) / BigInt(g.total_budget)) / 100;
                  return (
                    <li key={g.id} className="border-b border-line py-4 last:border-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link to={`/grants/${g.id}`} className="font-semibold hover:text-ox-600 hover:underline">Grant #{g.id}</Link>
                        <StatusPill label={statusLabel(g.status)} tone={statusTone(g.status)} />
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-mute">{shortAddr(g.agent)}</p>
                      <div className="mt-3"><BudgetBar pct={pct} /></div>
                      <p className="mt-1.5 flex justify-between font-mono text-xs text-mute">
                        <span><b className="font-medium text-ink">{ethFromWei(g.spent)}</b> ETH used</span>
                        <span>{ethFromWei(g.total_budget)} cap</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <p className="border border-line bg-card px-4 py-3 text-sm text-mute">
            {frozen > 0 ? (
              <><b className="text-warn">{frozen} grant{frozen === 1 ? " is" : "s are"} frozen.</b> Open it to review the strikes and unfreeze.</>
            ) : (
              <><b className="text-ok">No grants frozen.</b> A grant freezes after it hits its strike limit.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
