import { buildActionTree } from "@agentguard/shared/merkle";
import { parseEther } from "ethers";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { postManifest } from "../lib/api";
import { DEFAULT_ACTIONS, DEMO_AGENT } from "../lib/constants";
import { useWallet } from "../lib/wallet";

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
      setErr("Connect wallet (Hardhat account #0 as owner).");
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Create grant</h2>
        <p className="text-sm text-console-muted">On-chain policy + Merkle action whitelist</p>
      </div>

      {!chainOk && address && <p className="text-sm text-amber-300">Use Hardhat network in MetaMask before signing.</p>}

      <div className="flex gap-2 text-xs">
        {["Agent", "Actions", "Limits", "Sign"].map((l, i) => (
          <span key={l} className={i === step ? "text-emerald-400" : "text-console-muted"}>
            {i + 1}. {l}
          </span>
        ))}
      </div>

      <div className="panel space-y-4 p-6">
        {step === 0 && (
          <>
            <label className="block text-sm text-console-muted">Agent address</label>
            <input className="input" value={agent} onChange={(e) => setAgent(e.target.value)} />
            <button type="button" className="btn-ghost text-xs" onClick={() => setAgent(DEMO_AGENT)}>
              Use demo agent (Hardhat #1)
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <p className="text-sm text-console-muted">Toggle permitted actions</p>
            <div className="flex flex-wrap gap-2">
              {ALL_ACTIONS.map((a) => {
                const on = actions.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    className={`rounded-full px-3 py-1 text-sm font-mono ${on ? "bg-emerald-600/30 text-emerald-200 ring-1 ring-emerald-500/50" : "bg-console-bg text-console-muted ring-1 ring-console-border"}`}
                    onClick={() =>
                      setActions((prev) => (on ? prev.filter((x) => x !== a) : [...prev, a]))
                    }
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            <div>
              <div className="text-xs text-console-muted">Merkle root (live)</div>
              <div className="mt-1 break-all font-mono text-xs text-emerald-300">{tree.root}</div>
            </div>
          </>
        )}
        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Per-call cap (ETH)", perCall, setPerCall],
              ["Total budget (ETH)", budget, setBudget],
              ["Escrow (ETH)", escrow, setEscrow],
              ["Approval threshold (ETH)", approval, setApproval],
            ].map(([label, val, set]) => (
              <label key={label as string} className="block text-sm">
                <span className="text-console-muted">{label as string}</span>
                <input className="input mt-1" value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
              </label>
            ))}
          </div>
        )}
        {step === 3 && (
          <>
            <p className="rounded-lg bg-console-bg p-4 text-sm leading-relaxed">{preview}</p>
            <p className="font-mono text-xs text-console-muted">actionsRoot: {tree.root}</p>
          </>
        )}
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          {step < 3 ? (
            <button type="button" className="btn-primary" onClick={() => setStep((s) => s + 1)} disabled={actions.length === 0}>
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Signing…" : "Create grant in MetaMask"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
