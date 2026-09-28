import { AlertTriangle, Wallet } from "lucide-react";
import { useWallet } from "../lib/wallet";
import { shortAddr } from "../lib/format";

export function Header() {
  const { address, balance, chainOk, connect, connecting, config } = useWallet();

  return (
    <header className="border-b border-console-border bg-console-panel/50">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Security console</h1>
          <p className="text-xs text-console-muted">
            Policy on-chain · contract{" "}
            <span className="font-mono text-slate-400">{config ? shortAddr(config.address) : "…"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!chainOk && address && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Switch MetaMask to chain ID {config?.chainId ?? "?"}
            </span>
          )}
          {address ? (
            <div className="rounded-lg border border-console-border bg-console-bg px-3 py-2 text-right text-xs">
              <div className="font-mono text-emerald-300">{shortAddr(address)}</div>
              <div className="text-console-muted">{balance ?? "…"} ETH</div>
            </div>
          ) : (
            <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void connect()} disabled={connecting}>
              <Wallet className="h-4 w-4" />
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
