import { AlertTriangle, RotateCcw, Wallet, Zap } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "../lib/wallet";
import { devResetDemo } from "../lib/api";
import { shortAddr } from "../lib/format";

export function Header() {
  const { address, balance, chainOk, connect, connectDev, disconnect, connecting, config, isDevMode, refreshConfig } = useWallet();
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      await devResetDemo();
      // New contract address => reload config first, then drop every cached query so nothing stale is shown.
      await refreshConfig();
      await qc.resetQueries();
      window.dispatchEvent(new Event("agentguard:reset"));
    } catch (e: any) {
      alert(`Reset failed — nothing was wiped:\n${e.message}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <header className="border-b border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3 md:px-12">
        <p className="text-xs text-mute">
          Contract <span className="font-mono text-ink">{config ? shortAddr(config.address) : "…"}</span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {config && config.contractLive === false && (
            <span className="flex items-center gap-1.5 bg-[#F7EBD6] px-2.5 py-1 text-xs font-semibold text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              No contract on chain. Use Reset demo.
            </span>
          )}
          {!chainOk && address && (
            <span className="flex items-center gap-1.5 bg-bad px-2.5 py-1 text-xs font-semibold text-white">
              <AlertTriangle className="h-3.5 w-3.5" />
              Switch MetaMask to chain ID {config?.chainId ?? "?"}
            </span>
          )}

          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void handleReset()}
            disabled={resetting}
            title="Clears extra grants and audit events back to a clean Grant #1"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${resetting ? "animate-spin" : ""}`} />
            {resetting ? "Resetting…" : "Reset demo"}
          </button>

          {address ? (
            <div className="flex items-center gap-2 border border-line px-3 py-1 text-right">
              <div>
                <p className="flex items-center justify-end gap-1.5 font-mono text-xs font-medium text-ink">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDevMode ? "bg-warn" : "bg-ok"}`} />
                  {shortAddr(address)}
                </p>
                <p className="text-[11px] text-mute">
                  {balance ?? "…"} ETH{isDevMode ? " · dev owner" : ""}
                </p>
              </div>
              <button type="button" className="px-1.5 text-mute hover:text-ox-600" onClick={disconnect} aria-label="Disconnect wallet" title="Disconnect">
                ✕
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={() => void connectDev()} disabled={connecting} title="Connect as owner (account #0) without a browser extension">
                <Zap className="h-3.5 w-3.5" />
                1-click owner
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={() => void connect()} disabled={connecting}>
                <Wallet className="h-3.5 w-3.5" />
                {connecting ? "Connecting…" : "Connect MetaMask"}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
