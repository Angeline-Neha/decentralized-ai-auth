import { GATEWAY, AGENT_API } from "./constants";

async function gw<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export type ChainConfig = {
  address: string;
  chainId: number;
  rpcUrl: string;
  abi: unknown[];
  fingerprint?: string | null;
  contractLive?: boolean;
};

export function fetchConfig() {
  return gw<ChainConfig>("/config");
}

export function fetchGrants() {
  return gw<{ grants: GrantRow[] }>("/grants");
}

export function fetchGrant(id: number) {
  return gw<GrantDetail>(`/grants/${id}`);
}

export function fetchEvents(limit = 50) {
  return gw<{ events: AuditEvent[]; total: number }>(`/events?limit=${limit}`);
}

export function fetchPending() {
  return gw<{ pending: PendingRow[] }>("/pending");
}

export function verifyAudit(grantId?: number) {
  const q = grantId ? `?grantId=${grantId}` : "";
  return gw<VerifyResult>(`/audit/verify${q}`);
}

export function postManifest(grantId: number, actions: string[]) {
  return gw<{ root: string }>(`/grants/${grantId}/manifest`, {
    method: "POST",
    body: JSON.stringify({ actions }),
  });
}

export function runScenario(scenario: string, grantId?: number) {
  return fetch(`${AGENT_API}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, grantId }),
  }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(text);
    return JSON.parse(text);
  });
}

export function fetchScenarios() {
  return fetch(`${AGENT_API}/scenarios`).then((r) => r.json() as Promise<{ scenarios: string[] }>);
}

export function fetchProof(grantId: number, action: string) {
  return gw<{ grantId: number; action: string; proofs: { level: number; proof: string[] }[] }>(
    `/grants/${grantId}/proof?action=${encodeURIComponent(action)}`,
  );
}

export function devAdvanceTime(seconds: number) {
  return gw<{ advancedSeconds: number; timestamp: number }>("/dev/advance-time", {
    method: "POST",
    body: JSON.stringify({ seconds }),
  });
}

export function devTamperAudit(index: number) {
  return gw<{ tampered: number }>("/dev/tamper-audit", {
    method: "POST",
    body: JSON.stringify({ index }),
  });
}

export function devHealth() {
  return gw<{ rpcUrl: string; contract: string; chainId: number; devMode: boolean; contractLive?: boolean }>("/dev/health");
}

export async function devResetDemo() {
  const r = await fetch(`${GATEWAY}/dev/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (!r.ok) throw new Error(j?.error ?? j?.message ?? text);
  return j as { status: string; address?: string; message: string };
}

export interface GrantRow {
  id: number;
  owner: string;
  agent: string;
  parent_id?: number;
  depth?: number;
  status: number;
  strikes: number;
  max_strikes: number;
  spent: string;
  total_budget: string;
  escrow: string;
  expiry: number;
}

export interface GrantDetail {
  grant: GrantRow;
  onChain: { spent: string; escrow: string; strikes: number; status: number; nonce: string };
  manifest: { actions: string[]; root: string } | null;
  recentAudit: AuditEvent[];
  pending: PendingRow[];
}

export interface AuditEvent {
  index_num: number;
  grant_id: number;
  action_name: string | null;
  outcome: string | null;
  amount: string;
  head: string;
  tx_hash: string;
  code: number;
}

export interface PendingRow {
  pending_id: number;
  grant_id: number;
  amount: string;
  payee: string;
  action_id: string;
  expires_at: number;
}

export interface VerifyResult {
  valid: boolean;
  brokenAt: number | null;
  onChainHead: string;
  computedHead: string;
  entriesChecked: number;
}
