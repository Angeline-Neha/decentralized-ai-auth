import { GrantStatus } from "@agentguard/shared/reasons";

export function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h: string) {
  if (h.length < 14) return h;
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export function statusLabel(status: number) {
  if (status === GrantStatus.Active) return "Active";
  if (status === GrantStatus.Frozen) return "Frozen";
  if (status === GrantStatus.Revoked) return "Revoked";
  return `Status(${status})`;
}

export function statusTone(status: number): "ok" | "warn" | "bad" {
  if (status === GrantStatus.Active) return "ok";
  if (status === GrantStatus.Frozen) return "warn";
  return "bad";
}

export function ethFromWei(wei: string) {
  return (Number(BigInt(wei)) / 1e18).toFixed(4);
}

export function copy(text: string) {
  void navigator.clipboard.writeText(text);
}

/** Plain-language explanation for a contract Reason name. Falls back to the raw name. */
const REASON_TEXT: Record<string, string> = {
  Frozen: "The grant is frozen after repeated violations.",
  Revoked: "The owner revoked this grant.",
  Expired: "The grant has expired.",
  ActionNotAllowed: "This action is not on the grant's approved list.",
  OverCap: "The amount is above the per-call limit.",
  RateLimit: "Too many calls in the current time window.",
  OverBudget: "The grant's total budget would be exceeded.",
  InsufficientEscrow: "Not enough escrowed funds to cover this.",
  DelegationInvalid: "A delegated grant must be narrower than its parent.",
};

export function reasonText(outcome: string | null | undefined) {
  if (!outcome) return null;
  return REASON_TEXT[outcome] ?? outcome;
}

export type Verdict = { label: string; tone: "ok" | "warn" | "bad" | "neutral"; denied: boolean };

/** One place that decides how an audit code is shown, so every page agrees. */
export function verdict(code: number): Verdict {
  if (code === 0) return { label: "Allowed", tone: "ok", denied: false };
  if (code === 100) return { label: "Awaiting approval", tone: "warn", denied: false };
  if (code === 101) return { label: "Approved", tone: "ok", denied: false };
  if (code === 102) return { label: "Rejected by owner", tone: "neutral", denied: false };
  if (code === 103) return { label: "Delegated", tone: "ok", denied: false };
  return { label: "Denied", tone: "bad", denied: true };
}

export function timeAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
