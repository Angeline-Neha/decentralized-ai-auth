/** EIP-712 typed-data definitions shared by gateway, frontend, and agent. */

export const INTENT_TYPES = {
  Intent: [
    { name: "grantId", type: "uint256" },
    { name: "actionId", type: "bytes32" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paramsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const POLICY_FIELDS = [
  { name: "actionsRoot", type: "bytes32" },
  { name: "perCallCap", type: "uint256" },
  { name: "totalBudget", type: "uint256" },
  { name: "maxCallsPerWindow", type: "uint32" },
  { name: "windowSeconds", type: "uint64" },
  { name: "expiry", type: "uint64" },
  { name: "approvalThreshold", type: "uint256" },
  { name: "maxStrikes", type: "uint32" },
] as const;

export const DELEGATION_TYPES = {
  Delegation: [
    { name: "parentId", type: "uint256" },
    { name: "childAgent", type: "address" },
    { name: "policy", type: "Policy" },
    { name: "escrowShare", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Policy: POLICY_FIELDS,
} as const;

export interface IntentPayload {
  grantId: bigint;
  actionId: string;
  payee: string;
  amount: bigint;
  paramsHash: string;
  nonce: bigint;
  deadline: bigint;
}

export interface PolicyPayload {
  actionsRoot: string;
  perCallCap: bigint;
  totalBudget: bigint;
  maxCallsPerWindow: number;
  windowSeconds: bigint;
  expiry: bigint;
  approvalThreshold: bigint;
  maxStrikes: number;
}

export interface DelegationPayload {
  parentId: bigint;
  childAgent: string;
  policy: PolicyPayload;
  escrowShare: bigint;
  nonce: bigint;
  deadline: bigint;
}

export function agentGuardDomain(chainId: bigint, verifyingContract: string) {
  return {
    name: "AgentGuard",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}
