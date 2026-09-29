export const HARDHAT_CHAIN_ID = 31337;
export const DEMO_AGENT = "0x11a32cCeA9ABFa3e67f3ab5842CbD97dd74fdB88";
export const DEFAULT_ACTIONS = ["read_calendar", "send_email", "pay_invoice"] as const;

export const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? "/api/gateway";
export const AGENT_API = import.meta.env.VITE_AGENT_URL ?? "/api/agent";
