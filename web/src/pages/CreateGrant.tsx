import { buildActionTree } from "@agentguard/shared/merkle";
import { parseEther } from "ethers";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { postManifest } from "../lib/api";
import { DEFAULT_ACTIONS, DEMO_AGENT } from "../lib/constants";
import { useWallet } from "../lib/wallet";
import clsx from "clsx";
import { Field, Notice, PageHeader } from "../components/ui";

const ALL_ACTIONS = [...DEFAULT_ACTIONS, "transfer_funds"];

export function CreateGrantPage() {
  const { getContract, address, chainOk } = useWallet();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState(DEMO_AGENT);
  const [actions, setActions] = useState<string[]>([...DEFAULT_ACTIONS]);
  const [perCall, setPerCall] = useState("0.1");
  const [budget, setBudget] = useState("0.5");
  const [escrow, setEscrow] = useState("1");
  const [approval, setApproval] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tree = useMemo(() => buildActionTree(actions), [actions]);
  const expiry = useMemo(() => Math.floor(Date.now() / 1000) + 86400, []);

  const preview = `This agent may ${actions.join(", ")}. Up to ${perCall} ETH per call, ${budget} ETH total budget, until ${new Date(expiry * 1000).toLocaleString()}.`;

  async function submit() {
    const guard = getContract();
    if (!guard || !address) {
      setErr("Please connect your wallet (Account #0 as owner) using the 'Connect wallet' button in the top right.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const nextId = await guard.nextGrantId();
      const params = {
        agent,
        actionsRoot: tree.root,
        perCallCap: parseEther(perCall),
        totalBudget: parseEther(budget),
        maxCallsPerWindow: 5,
        windowSeconds: 3600,
        expiry,
        approvalThreshold: parseEther(approval),
        maxStrikes: 3,
      };
      const tx = await guard.createGrant(params, { value: parseEther(escrow) });
      await tx.wait();
      const grantId = Number(nextId);
      await postManifest(grantId, actions);
      nav(`/grants/${grantId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const STEPS = [
    { name: "Agent", help: "Who receives the permission" },
    { name: "Actions", help: "What they may do" },
    { name: "Limits", help: "How much they may spend" },
    { name: "Review", help: "Sign and create" },
  ];
  const LIMITS: Array<[string, string, (v: string) => void, string]> = [
    ["Per-call cap (ETH)", perCall, setPerCall, "Largest amount a single call may move."],
    ["Total budget (ETH)", budget, setBudget, "Most the agent may spend across all calls."],
    ["Escrow (ETH)", escrow, setEscrow, "Funds locked in the contract to cover spending."],
    ["Approval threshold (ETH)", approval, setApproval, "Calls above this wait for your co-sign."],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title="Create a grant" lead="Decide what one agent may do and how much it may spend. The rules are written to the contract and cannot be widened by the agent." />

      {!chainOk && address && <Notice tone="warn">Switch MetaMask to RPC http://127.0.0.1:7545 (chain ID 1337) before signing.</Notice>}

      <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((st, i) => (
          <li key={st.name}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              className={clsx("w-full border-t-4 pt-2 text-left", i === step ? "border-ox-600" : i < step ? "border-ox-300" : "border-line", i > step && "cursor-default")}
            >
              <span className={clsx("block text-sm font-semibold", i === step ? "text-ox-600" : "text-mute")}>{i + 1}. {st.name}</span>
              <span className="hidden text-xs text-mute sm:block">{st.help}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="sheet space-y-5">
        {step === 0 && (
          <>
            <Field label="Agent address" hint="The wallet the agent signs with.">
              <input className="input" value={agent} onChange={(e) => setAgent(e.target.value)} spellCheck={false} />
            </Field>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAgent(DEMO_AGENT)}>
              Use the demo agent
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <span className="field-label">Permitted actions</span>
              <p className="field-hint mb-3 mt-0">Anything not selected is refused, even if the agent is tricked into asking.</p>
              <div className="flex flex-wrap gap-2">
                {ALL_ACTIONS.map((a) => {
                  const on = actions.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      className={clsx("border px-3 py-1.5 font-mono text-sm transition-colors", on ? "border-ox-600 bg-ox-600 text-white" : "border-line bg-card text-mute hover:border-ox-500 hover:text-ox-600")}
                      onClick={() => setActions((prev) => (on ? prev.filter((x) => x !== a) : [...prev, a]))}
                    >
                      {on ? "✓ " : ""}{a}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="field-label">Merkle root</span>
              <p className="break-all bg-sunk px-3 py-2 font-mono text-xs">{tree.root}</p>
              <p className="field-hint">This one hash stands for the whole list and is what the contract stores.</p>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {LIMITS.map(([label, val, set, hint]) => (
              <Field key={label} label={label} hint={hint}>
                <input className="input" inputMode="decimal" value={val} onChange={(e) => set(e.target.value)} />
              </Field>
            ))}
          </div>
        )}

        {step === 3 && (
          <>
            <p className="border-l-4 border-ox-600 bg-ox-50 p-4 text-[15px] leading-relaxed">{preview}</p>
            <p className="break-all font-mono text-xs text-mute">actionsRoot {tree.root}</p>
          </>
        )}

        {err && <Notice tone="bad">{err}</Notice>}

        <div className="flex justify-between border-t border-line pt-5">
          <button type="button" className="btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          {step < 3 ? (
            <button type="button" className="btn-primary" onClick={() => setStep((s) => s + 1)} disabled={actions.length === 0}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Waiting for signature…" : "Create grant"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
