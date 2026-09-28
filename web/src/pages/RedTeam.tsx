import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchScenarios, runScenario } from "../lib/api";
import { AGENT_API } from "../lib/constants";

const SCENARIO_LABELS: Record<string, string> = {
  normal_day: "Normal day",
  prompt_injection: "Prompt injection",
  over_cap: "Exceed cap",
  unlisted_action: "Unlisted action",
  replay_signature: "Replay signature",
  rate_limit_burst: "Rate limit burst",
};

export function RedTeamPage() {
  const [grantId, setGrantId] = useState(1);
  const [thoughts, setThoughts] = useState<{ text: string; at: string }[]>([]);
  const [lastResult, setLastResult] = useState<unknown>(null);

  const scenariosQ = useQuery({ queryKey: ["scenarios"], queryFn: fetchScenarios });

  useEffect(() => {
    const es = new EventSource(`${AGENT_API}/thoughts`);
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as { text: string; at: string };
        setThoughts((prev) => [...prev.slice(-40), d]);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const run = useMutation({
    mutationFn: (scenario: string) => runScenario(scenario, grantId),
    onSuccess: setLastResult,
  });

  const list = scenariosQ.data?.scenarios ?? Object.keys(SCENARIO_LABELS);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Red team console</h2>
        <p className="text-sm text-console-muted">Runs real scenarios via the Python agent → gateway → contract</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        Grant ID
        <input className="input w-24" type="number" value={grantId} onChange={(e) => setGrantId(Number(e.target.value))} />
      </label>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="panel space-y-2 p-4">
          <h3 className="text-sm font-medium text-console-muted">Attacks</h3>
          {list.map((s) => (
            <button
              key={s}
              type="button"
              className="btn-ghost w-full text-left"
              disabled={run.isPending}
              onClick={() => run.mutate(s)}
            >
              {SCENARIO_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        <div className="panel max-h-[420px] overflow-y-auto p-4 lg:col-span-1">
          <h3 className="mb-2 text-sm font-medium text-console-muted">Agent thoughts</h3>
          <ul className="space-y-2 text-sm">
            {thoughts.length === 0 && <li className="text-console-muted">Run a scenario…</li>}
            {thoughts.map((t, i) => (
              <li key={i} className="rounded-lg bg-console-bg/80 px-3 py-2">
                {t.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-4 lg:col-span-1">
          <h3 className="mb-2 text-sm font-medium text-console-muted">Contract response</h3>
          {run.isError && <p className="text-sm text-red-400">{(run.error as Error).message}</p>}
          {lastResult ? (
            <pre className="max-h-80 overflow-auto rounded-lg bg-console-bg p-3 font-mono text-xs text-slate-300">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-console-muted">No run yet. Start agent on :8000.</p>
          )}
        </div>
      </div>
    </div>
  );
}
