import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    /** Ganache GUI default: :7545, network id 5777. Override with GANACHE_RPC_URL / GANACHE_CHAIN_ID */
    ganache: {
      url: process.env.GANACHE_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:7545",
      chainId: Number(process.env.GANACHE_CHAIN_ID ?? process.env.CHAIN_ID ?? 5777),
    },
  },
};

export default config;
