import type { InterfaceAbi } from "ethers";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { config } from "../config.js";

const abi = config.deployment.abi as InterfaceAbi;

let provider: JsonRpcProvider | null = null;
let relayer: Wallet | null = null;
let guard: Contract | null = null;

export function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(config.rpcUrl);
  return provider;
}

export function getRelayer(): Wallet {
  if (!relayer) relayer = new Wallet(config.relayerPrivateKey, getProvider());
  return relayer;
}

export function getGuard(): Contract {
  if (!guard) {
    guard = new Contract(config.deployment.address, abi, getRelayer());
  }
  return guard;
}

export function getGuardReadOnly(): Contract {
  return new Contract(config.deployment.address, abi, getProvider());
}

export async function getDomain() {
  const chainId = BigInt(config.deployment.chainId);
  return {
    name: "AgentGuard",
    version: "1",
    chainId,
    verifyingContract: config.deployment.address,
  } as const;
}
