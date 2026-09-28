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
