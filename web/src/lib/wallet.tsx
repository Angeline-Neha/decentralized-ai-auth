import { BrowserProvider, Contract, JsonRpcProvider, Wallet, type InterfaceAbi, type Signer } from "ethers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchConfig, type ChainConfig } from "./api";
import { GATEWAY } from "./constants";

const WALLET_KEY = "agentguard.wallet"; // remembers which wallet mode to auto-restore after a refresh
const DEV_OWNER_PRIVATE_KEY = "0x79ccfcb428668eb125c1ca954de251a9d4f985bd3e9abfd88bea9343f4451de1";

type WalletCtx = {
  config: ChainConfig | null;
  address: string | null;
  balance: string | null;
  chainOk: boolean;
  connecting: boolean;
  isDevMode: boolean;
  connect: () => Promise<void>;
  connectDev: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  disconnect: () => void;
  getContract: () => Contract | null;
  getSigner: () => Signer | null;
  provider: BrowserProvider | JsonRpcProvider | null;
};

const Ctx = createContext<WalletCtx | null>(null);

function getEthereumProvider(): any {
  if (typeof window === "undefined") return null;
  const anyWin = window as any;
  if (!anyWin.ethereum) return null;
  if (Array.isArray(anyWin.ethereum.providers)) {
    const mm = anyWin.ethereum.providers.find((p: any) => p.isMetaMask);
    if (mm) return mm;
    return anyWin.ethereum.providers[0];
  }
  return anyWin.ethereum;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | JsonRpcProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  const qc = useQueryClient();

  // The contract address changes on every "Reset Demo" / redeploy. Keep config fresh instead of reading it once.
  const refreshConfig = useCallback(async () => {
    try {
      const next = await fetchConfig();
      setConfig((prev) =>
        prev &&
        prev.address === next.address &&
        prev.chainId === next.chainId &&
        prev.rpcUrl === next.rpcUrl &&
        prev.contractLive === next.contractLive &&
        prev.fingerprint === next.fingerprint
          ? prev
          : next,
      );
    } catch (e) {
      console.error("config refresh failed:", e);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    const t = setInterval(() => void refreshConfig(), 4000);
    const onFocus = () => void refreshConfig();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshConfig]);

  // One app-wide SSE connection: any chain event invalidates cached queries so trees/graphs/lists update
  // immediately; a reset also reloads config and drops every cached query.
  useEffect(() => {
    const es = new EventSource(`${GATEWAY}/stream`);
    const invalidate = () => void qc.invalidateQueries();
    const onReset = () => {
      void refreshConfig().then(() => qc.resetQueries());
      window.dispatchEvent(new Event("agentguard:reset"));
    };
    es.addEventListener("audit", invalidate);
    es.addEventListener("grant", (ev) => {
      try {
        if (JSON.parse((ev as MessageEvent).data as string)?.event === "Reset") return onReset();
      } catch {
        /* ignore */
      }
      invalidate();
    });
    es.addEventListener("pending", invalidate);
    es.addEventListener("reset", onReset);
    es.onopen = () => {
      void refreshConfig();
      invalidate();
    };
    return () => es.close();
  }, [qc, refreshConfig]);

  const refreshBalance = useCallback(
    async (p: BrowserProvider | JsonRpcProvider, addr: string) => {
      try {
        const bal = await p.getBalance(addr);
        setBalance((Number(bal) / 1e18).toFixed(4));
        const net = await p.getNetwork();
        const expected = config?.chainId;
        setChainOk(expected === undefined || Number(net.chainId) === Number(expected));
      } catch (e) {
        console.error("Failed to refresh balance/network:", e);
      }
    },
    [config?.chainId],
  );

  useEffect(() => {
    if (provider && address) void refreshBalance(provider, address);
  }, [config?.chainId, config?.address, provider, address, refreshBalance]);

  const connectDev = useCallback(async () => {
    if (!config) return;
    setConnecting(true);
    try {
      const rpc = config.rpcUrl || "http://127.0.0.1:7545";
      const p = new JsonRpcProvider(rpc);
      const w = new Wallet(DEV_OWNER_PRIVATE_KEY, p);
      const addr = await w.getAddress();
      setProvider(p);
      setSigner(w);
      setAddress(addr);
      setIsDevMode(true);
      setChainOk(true);
      try {
        localStorage.setItem(WALLET_KEY, "dev");
      } catch {
        /* ignore */
      }
      await refreshBalance(p, addr);
    } catch (e: any) {
      alert(`Could not connect local owner: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  }, [config, refreshBalance]);

  const connect = useCallback(async () => {
    const eth = getEthereumProvider();
    if (!eth) {
      const useLocal = confirm(
        "MetaMask extension was not detected in this browser window.\n\nWould you like to connect using the 1-Click Local Owner Account #0 (Dev Mode) instead?",
      );
      if (useLocal) {
        await connectDev();
      }
      return;
    }
    setConnecting(true);
    try {
      const p = new BrowserProvider(eth);
      await p.send("eth_requestAccounts", []);
      
      // Attempt to auto-switch to target chain if configured
      if (config?.chainId) {
        const chainIdHex = "0x" + Number(config.chainId).toString(16);
        try {
          await p.send("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
        } catch (switchErr: any) {
          if (switchErr.code === 4902 || switchErr?.data?.originalError?.code === 4902) {
            await p.send("wallet_addEthereumChain", [
              {
                chainId: chainIdHex,
                chainName: "Ganache Local",
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: [config.rpcUrl || "http://127.0.0.1:7545"],
              },
            ]);
          }
        }
      }

      const s = await p.getSigner();
      const addr = await s.getAddress();
      setProvider(p);
      setSigner(s);
      setAddress(addr);
      setIsDevMode(false);
      try {
        localStorage.setItem(WALLET_KEY, "metamask");
      } catch {
        /* ignore */
      }
      await refreshBalance(p, addr);
    } catch (e: any) {
      console.error(e);
      alert(`MetaMask connection error: ${e.message ?? e}`);
    } finally {
      setConnecting(false);
    }
  }, [config, refreshBalance, connectDev]);

  const disconnect = useCallback(() => {
    try {
      localStorage.removeItem(WALLET_KEY);
    } catch {
      /* ignore */
    }
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setBalance(null);
    setChainOk(false);
    setIsDevMode(false);
  }, []);

  // Restore the wallet after a page refresh (no prompt: eth_accounts only returns already-authorised accounts).
  useEffect(() => {
    if (!config || address) return;
    let mode: string | null = null;
    try {
      mode = localStorage.getItem(WALLET_KEY);
    } catch {
      /* ignore */
    }
    if (mode === "dev") void connectDev();
    else if (mode === "metamask") {
      const eth = getEthereumProvider();
      if (!eth) return;
      (async () => {
        try {
          const accts: string[] = await eth.request({ method: "eth_accounts" });
          if (!accts.length) return;
          const p = new BrowserProvider(eth);
          const s = await p.getSigner();
          const addr = await s.getAddress();
          setProvider(p);
          setSigner(s);
          setAddress(addr);
          setIsDevMode(false);
          await refreshBalance(p, addr);
        } catch (e) {
          console.error("wallet restore failed:", e);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.address]);

  // React to MetaMask account / network switches instead of showing stale balance and chain warnings.
  useEffect(() => {
    const eth = getEthereumProvider();
    if (!eth?.on || isDevMode) return;
    const onAccounts = async (accts: string[]) => {
      if (!accts.length) return disconnect();
      if (provider instanceof BrowserProvider) {
        const s = await provider.getSigner();
        setSigner(s);
        setAddress(await s.getAddress());
        await refreshBalance(provider, accts[0]);
      }
    };
    const onChain = () => window.location.reload();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [provider, isDevMode, disconnect, refreshBalance]);

  const getContract = useCallback(() => {
    if (!config || !signer) return null;
    return new Contract(config.address, config.abi as InterfaceAbi, signer);
  }, [config, signer]);

  const value = useMemo(
    () => ({
      config,
      address,
      balance,
      chainOk,
      connecting,
      isDevMode,
      connect,
      connectDev,
      refreshConfig,
      disconnect,
      getContract,
      getSigner: () => signer,
      provider,
    }),
    [config, address, balance, chainOk, connecting, isDevMode, connect, connectDev, refreshConfig, disconnect, getContract, signer, provider],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider required");
  return v;
}
