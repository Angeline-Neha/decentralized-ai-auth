export const HARDHAT_CHAIN_ID = 31337;
export const DEMO_AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const DEFAULT_ACTIONS = ["read_calendar", "send_email", "pay_invoice"] as const;

export const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? "/api/gateway";
export const AGENT_API = import.meta.env.VITE_AGENT_URL ?? "/api/agent";
