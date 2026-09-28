import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchEvents, fetchGrants } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { StatusPill } from "../components/StatusPill";
import { useEventStream } from "../hooks/useEventStream";
import { ethFromWei, shortAddr, statusLabel, statusTone } from "../lib/format";
import { GrantStatus } from "@agentguard/shared/reasons";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export function DashboardPage() {
  const grantsQ = useQuery({ queryKey: ["grants"], queryFn: fetchGrants, refetchInterval: 8000 });
  const eventsQ = useQuery({ queryKey: ["events"], queryFn: () => fetchEvents(100), refetchInterval: 8000 });
  const live = useEventStream(15);

  const grants = grantsQ.data?.grants ?? [];
  const events = eventsQ.data?.events ?? [];
  const active = grants.filter((g) => g.status === GrantStatus.Active).length;
  const frozen = grants.filter((g) => g.status === GrantStatus.Frozen).length;
  const blocked = events.filter((e) => e.code > 0 && e.code < 100).length;
  const spent = grants.reduce((s, g) => s + BigInt(g.spent), 0n);
  const chartData = [...events]
    .reverse()
    .slice(-20)
    .map((e) => ({
      name: `#${e.index_num}`,
      ok: e.code === 0 || e.code >= 100 ? 1 : 0,
      deny: e.code > 0 && e.code < 100 ? 1 : 0,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <p className="text-sm text-console-muted">Live policy enforcement overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active grants" value={active} tone="ok" />
        <StatCard label="Frozen agents" value={frozen} tone={frozen ? "warn" : "neutral"} />
        <StatCard label="Denied (indexed)" value={blocked} tone={blocked ? "bad" : "neutral"} />
        <StatCard label="Budget used (ETH)" value={(Number(spent) / 1e18).toFixed(3)} hint="Across indexed grants" />
      </div>

      {chartData.length > 0 && (
        <section className="panel p-4">
          <h3 className="mb-2 text-sm font-medium text-console-muted">Recent outcomes</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fill: "#8b9cb3", fontSize: 10 }} />
                <YAxis hide domain={[0, 1]} />
                <Tooltip contentStyle={{ background: "#1a2332", border: "1px solid #2d3a4f" }} />
                <Bar dataKey="ok" stackId="a" fill="#22c55e" name="Allowed" />
                <Bar dataKey="deny" stackId="a" fill="#ef4444" name="Denied" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-4">
          <h3 className="mb-3 font-medium">Grants</h3>
          {grants.length === 0 ? (
            <p className="text-sm text-console-muted">No grants yet. Create one or run npm run seed.</p>
          ) : (
            <ul className="divide-y divide-console-border">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-3">
                  <div>
                    <Link to={`/grants/${g.id}`} className="font-mono text-sm text-emerald-300 hover:underline">
                      Grant #{g.id}
                    </Link>
                    <div className="text-xs text-console-muted">Agent {shortAddr(g.agent)}</div>
                  </div>
                  <div className="text-right">
                    <StatusPill label={statusLabel(g.status)} tone={statusTone(g.status)} />
                    <div className="mt-1 text-xs text-console-muted">
                      {ethFromWei(g.spent)} / {ethFromWei(g.total_budget)} ETH
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-4">
          <h3 className="mb-3 font-medium">Live activity</h3>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {live.length === 0 && <li className="text-console-muted">Waiting for SSE events…</li>}
            {live.map((item, i) => (
              <li key={i} className="rounded-lg border border-console-border/60 bg-console-bg/50 px-3 py-2">
                <span className="text-xs uppercase text-console-muted">{item.type}</span>
                <pre className="mt-1 overflow-x-auto font-mono text-xs text-slate-300">
                  {JSON.stringify(item.data, null, 0).slice(0, 120)}…
                </pre>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
