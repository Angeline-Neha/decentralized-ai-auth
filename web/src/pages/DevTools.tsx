import { useMutation, useQuery } from "@tanstack/react-query";
import { devAdvanceTime, devHealth, devTamperAudit, verifyAudit } from "../lib/api";

const DEMO_STEPS = [
  "npm run chain",
  "npm run deploy && npm run seed",
  "copy gateway/.env.example gateway/.env && npm run gateway",
  "agent venv + uvicorn (or npm run agent)",
  "npm run web → connect MetaMask #0 on chain 31337",
  "Red team → prompt_injection, then Audit → Verify chain",
  "Dev tools → tamper row → Verify chain fails",
  "python agent/scripts/verify_audit.py (independent verifier)",
];

export function DevToolsPage() {
  const health = useQuery({ queryKey: ["dev-health"], queryFn: devHealth });
  const verify = useQuery({ queryKey: ["audit-verify"], queryFn: () => verifyAudit(), enabled: false });

  const advance = useMutation({ mutationFn: (s: number) => devAdvanceTime(s) });
  const tamper = useMutation({
    mutationFn: (index: number) => devTamperAudit(index),
    onSuccess: () => void verify.refetch(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Dev & demo tools</h2>
        <p className="text-sm text-console-muted">Hardhat time travel and audit tampering for viva demos</p>
      </div>

      <div className="panel grid gap-2 p-4 text-sm sm:grid-cols-2">
        <div>RPC: {health.data?.rpcUrl ?? "…"}</div>
        <div>Contract: {health.data?.contract ?? "…"}</div>
        <div>Chain ID: {health.data?.chainId ?? "…"}</div>
        <div>Dev mode: {String(health.data?.devMode ?? false)}</div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-ghost" disabled={advance.isPending} onClick={() => advance.mutate(3600)}>
          Advance time +1h
        </button>
        <button type="button" className="btn-ghost" disabled={advance.isPending} onClick={() => advance.mutate(86400)}>
          Advance time +1d
        </button>
        <button type="button" className="btn-danger" disabled={tamper.isPending} onClick={() => tamper.mutate(0)}>
          Tamper audit row #0
        </button>
        <button type="button" className="btn-primary" onClick={() => void verify.refetch()}>
          Re-verify audit chain
        </button>
      </div>

      {verify.data && (
        <p className={`text-sm ${verify.data.valid ? "text-emerald-300" : "text-red-300"}`}>
          Verify: {verify.data.valid ? "VALID" : `BROKEN at ${verify.data.brokenAt}`}
        </p>
      )}

      <section className="panel p-4">
        <h3 className="font-medium">Demo script (viva)</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-console-muted">
          {DEMO_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
