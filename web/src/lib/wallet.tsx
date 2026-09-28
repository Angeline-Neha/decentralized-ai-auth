import { BrowserProvider, Contract, JsonRpcSigner, Eip1193Provider } from "ethers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchConfig, type ChainConfig } from "./api";

type WalletCtx = {
  config: ChainConfig | null;
  address: string | null;
  balance: string | null;
  chainOk: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  getContract: () => Contract | null;
  getSigner: () => JsonRpcSigner | null;
  provider: BrowserProvider | null;
};

const Ctx = createContext<WalletCtx | null>(null);

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
  }, []);

  const refresh = useCallback(
    async (p: BrowserProvider, addr: string) => {
      const bal = await p.getBalance(addr);
      setBalance((Number(bal) / 1e18).toFixed(4));
      const net = await p.getNetwork();
      const expected = config?.chainId;
      setChainOk(expected === undefined || Number(net.chainId) === Number(expected));
    },
    [config?.chainId],
  );

  useEffect(() => {
    if (provider && address && config) {
      void refresh(provider, address);
    }
  }, [config?.chainId, provider, address, refresh, config]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("Install MetaMask and import a Hardhat account.");
      return;
    }
    setConnecting(true);
    try {
      const p = new BrowserProvider(window.ethereum);
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      const addr = await s.getAddress();
      setProvider(p);
      setSigner(s);
      setAddress(addr);
      await refresh(p, addr);
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const getContract = useCallback(() => {
    if (!config || !signer) return null;
    return new Contract(config.address, config.abi, signer);
  }, [config, signer]);

  const value = useMemo(
    () => ({
      config,
      address,
      balance,
      chainOk,
      connecting,
      connect,
      getContract,
      getSigner: () => signer,
      provider,
    }),
    [config, address, balance, chainOk, connecting, connect, getContract, signer, provider],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider required");
  return v;
}
