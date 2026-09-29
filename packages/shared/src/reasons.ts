/** Mirrors `enum Reason` in AgentGuard.sol */
export const Reason = {
  None: 0,
  Frozen: 1,
  Revoked: 2,
  Expired: 3,
  ActionNotAllowed: 4,
  OverCap: 5,
  RateLimit: 6,
  OverBudget: 7,
  InsufficientEscrow: 8,
  DelegationInvalid: 9,
} as const;

export type ReasonCode = (typeof Reason)[keyof typeof Reason];

export const ReasonLabel: Record<number, string> = {
  [Reason.None]: "None",
  [Reason.Frozen]: "Frozen",
  [Reason.Revoked]: "Revoked",
  [Reason.Expired]: "Expired",
  [Reason.ActionNotAllowed]: "ActionNotAllowed",
  [Reason.OverCap]: "OverCap",
  [Reason.RateLimit]: "RateLimit",
  [Reason.OverBudget]: "OverBudget",
  [Reason.InsufficientEscrow]: "InsufficientEscrow",
  [Reason.DelegationInvalid]: "DelegationInvalid",
};

/** Audit lifecycle codes from the contract (100+). */
export const AuditCode = {
  Executed: 0,
  Pending: 100,
  Approved: 101,
  Rejected: 102,
  Delegated: 103,
} as const;

// NOTE: spread ReasonLabel FIRST. Reason.None (0) collides with AuditCode.Executed (0);
// spreading it last used to overwrite "Executed" with "None" for every executed action.
export const AuditCodeLabel: Record<number, string> = {
  ...ReasonLabel,
  [AuditCode.Executed]: "Executed",
  [AuditCode.Pending]: "Pending",
  [AuditCode.Approved]: "Approved",
  [AuditCode.Rejected]: "Rejected",
  [AuditCode.Delegated]: "Delegated",
};

export function auditOutcomeLabel(code: number): string {
  return AuditCodeLabel[code] ?? `Unknown(${code})`;
}

export const GrantStatus = {
  Active: 0,
  Frozen: 1,
  Revoked: 2,
} as const;

export const PendingStatus = {
  None: 0,
  Pending: 1,
  Approved: 2,
  Rejected: 3,
} as const;
