import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchScenarios, runScenario } from "../lib/api";
import { AGENT_API } from "../lib/constants";
import { Empty, Notice, PageHeader, Section } from "../components/ui";
import clsx from "clsx";

const SCENARIOS: Record<string, { label: string; what: string }> = {
  normal_day: { label: "Normal day", what: "Routine allowed actions. Everything should pass." },
  prompt_injection: { label: "Prompt injection", what: "A hidden instruction tries to redirect the agent." },
  over_cap: { label: "Exceed cap", what: "Asks to move more than the per-call limit." },
  unlisted_action: { label: "Unlisted action", what: "Calls an action that is not on the grant." },
  replay_signature: { label: "Replay signature", what: "Resends an already-used signed request." },
  rate_limit_burst: { label: "Rate limit burst", what: "Fires many calls to exhaust the window." },
};

export function RedTeamPage() {
  const [grantId, setGrantId] = useState(1);
  const [thoughts, setThoughts] = useState<{ text: string; at: string }[]>([]);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [running, setRunning] = useState<string | null>(null);

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
    mutationFn: (scenario: string) => {
      setRunning(scenario);
      return runScenario(scenario, grantId);
    },
    onSuccess: setLastResult,
    onSettled: () => setRunning(null),
  });

  const list = scenariosQ.data?.scenarios ?? Object.keys(SCENARIOS);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Red team"
        lead="Launch a real attack from the Python agent and watch the gateway and contract respond. Results also appear in the audit log."
        actions={
          <label className="flex items-center gap-2 text-sm font-semibold">
            Target grant
            <input className="input w-20 text-center" type="number" min={1} value={grantId} onChange={(e) => setGrantId(Number(e.target.value))} />
          </label>
        }
      />

      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="Attacks" meta={`${list.length} scenarios`}>
          <ul className="divide-y divide-line">
            {list.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={run.isPending}
                  onClick={() => run.mutate(s)}
                  className={clsx("group flex w-full items-center justify-between gap-4 py-4 text-left transition-colors disabled:cursor-not-allowed", running === s ? "text-ox-600" : "hover:text-ox-600")}
                >
                  <span>
                    <span className="block font-semibold">{SCENARIOS[s]?.label ?? s}</span>
                    <span className="block text-sm font-normal text-mute">{SCENARIOS[s]?.what ?? "Custom scenario."}</span>
                  </span>
                  <span className={clsx("shrink-0 border px-3 py-1 text-xs font-semibold", running === s ? "border-ox-600 bg-ox-600 text-white" : "border-line text-mute group-hover:border-ox-500 group-hover:text-ox-600")}>
                    {running === s ? "Running…" : "Run"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <div className="space-y-10">
          <Section title="Agent thoughts" meta="live">
            <div className="max-h-72 overflow-y-auto">
              {thoughts.length === 0 ? (
                <p className="py-6 text-sm text-mute">Run an attack to see what the agent is reasoning.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {thoughts.map((t, i) => (
                    <li key={i} className="py-2.5 text-sm leading-relaxed">{t.text}</li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Contract response">
            {run.isError && <div className="mt-4"><Notice tone="bad">{(run.error as Error).message}</Notice></div>}
            {lastResult ? (
              <pre className="mt-4 max-h-80 overflow-auto bg-sunk p-4 font-mono text-xs leading-relaxed">{JSON.stringify(lastResult, null, 2)}</pre>
            ) : (
              !run.isError && (
                <div className="mt-4">
                  <Empty title="No run yet" hint="Pick an attack on the left. The agent service must be running on port 8000." />
                </div>
              )
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
