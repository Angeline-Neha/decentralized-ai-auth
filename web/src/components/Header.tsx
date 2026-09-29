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
          <button
            type="button"
            className="btn-ghost flex items-center gap-1.5 text-xs text-slate-300 border border-console-border hover:bg-white/10"
            onClick={() => void handleReset()}
            disabled={resetting}
            title="Reset demo state: clears extra grants and audit events back to clean Grant #1"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${resetting ? "animate-spin text-cyan-400" : ""}`} />
            {resetting ? "Resetting…" : "Reset Demo"}
          </button>

          {config && config.contractLive === false && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              No contract on chain — click Reset Demo
            </span>
          )}
          {!chainOk && address && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Switch MetaMask to chain ID {config?.chainId ?? "?"}
            </span>
          )}
          {address ? (
            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-console-border bg-console-bg px-3 py-1.5 text-right text-xs">
                <div className="flex items-center gap-1.5 font-mono text-emerald-300">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDevMode ? "bg-cyan-400" : "bg-emerald-400"}`} />
                  {shortAddr(address)}
                </div>
                <div className="text-console-muted">
                  {balance ?? "…"} ETH {isDevMode ? "(Dev Owner)" : ""}
                </div>
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-console-muted hover:bg-white/10 hover:text-white"
                onClick={disconnect}
                title="Disconnect"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 text-xs text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10"
                onClick={() => void connectDev()}
                disabled={connecting}
                title="Connect directly as Owner (Account #0) without needing browser extensions"
              >
                <Zap className="h-3.5 w-3.5" />
                1-Click Owner
              </button>
              <button
                type="button"
                className="btn-primary flex items-center gap-2 text-xs"
                onClick={() => void connect()}
                disabled={connecting}
              >
                <Wallet className="h-4 w-4" />
                {connecting ? "Connecting…" : "Connect MetaMask"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
