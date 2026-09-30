import { ZeroHash } from "ethers";
import {
  inspectAuditChain,
  remineHeads,
  type AuditBlockInput,
  type AuditChainTruth,
  type BlockInspection,
} from "@agentguard/shared";
import { getDb } from "../db/index.js";
import { getGuardReadOnly, getProvider } from "../contract/client.js";
import { config } from "../config.js";
import { syncNow } from "../indexer/index.js";
import { labelAuditCode, resolveActionName } from "../proof/service.js";
import { sse } from "../sse/broadcaster.js";
import type { AuditRow } from "../db/index.js";

function toBigIntSafe(val: any, fallback = 0n): bigint {
  try {
    if (val === null || val === undefined) return fallback;
    const s = String(val).trim();
    if (!s) return fallback;
    if (s.includes(".")) return BigInt(s.split(".")[0]);
    return BigInt(s);
  } catch {
    return fallback;
  }
}

function rowToBlock(r: AuditRow): AuditBlockInput {
  return {
    index: r.index_num,
    grantId: toBigIntSafe(r.grant_id),
    actionId: r.action_id || ZeroHash,
    amount: toBigIntSafe(r.amount),
    paramsHash: r.params_hash || ZeroHash,
    code: Number(r.code) || 0,
    blockNumber: toBigIntSafe(r.block_number),
    head: r.head || ZeroHash,
  };
}

// ───────────────────────────── On-chain ground truth (cached) ─────────────────────────────

let truthCache: { key: string; truth: AuditChainTruth & { txByIndex: Map<number, string> } } | null = null;
const blockTimeCache = new Map<string, number>();
const nonceCache = new Map<string, string | null>();
let deployCache: { address: string; info: { blockNumber: number; timestamp: number } | null } | null = null;

async function loadChainTruth() {
  const guard = getGuardReadOnly();
  const [head, count] = await Promise.all([guard.auditHead() as Promise<string>, guard.auditCount() as Promise<bigint>]);
  const key = `${config.deployment.address}:${count}:${head}`;
  if (truthCache?.key === key) return truthCache.truth;
  const logs = await guard.queryFilter(guard.filters.AuditAppended(), 0);
  const txByIndex = new Map<number, string>();
  const events: AuditBlockInput[] = [];
  for (const log of logs) {
    const a = (log as any).args;
    if (!a) continue;
    txByIndex.set(Number(a.index), log.transactionHash);
    events.push({
      index: Number(a.index),
      grantId: BigInt(a.grantId),
      actionId: a.actionId as string,
      amount: BigInt(a.amount),
      paramsHash: a.paramsHash as string,
      code: Number(a.code),
      blockNumber: BigInt(log.blockNumber),
      head: a.head as string,
    });
  }
  events.sort((x, y) => x.index - y.index);
  const truth = { events, head, count: Number(count), txByIndex };
  truthCache = { key, truth };
  return truth;
}

async function blockTimestamp(blockNumber: number): Promise<number | null> {
  const key = `${config.deployment.address}:${blockNumber}`;
  if (blockTimeCache.has(key)) return blockTimeCache.get(key)!;
  try {
    const b = await getProvider().getBlock(blockNumber);
    if (!b) return null;
    blockTimeCache.set(key, b.timestamp);
    return b.timestamp;
  } catch {
    return null;
  }
}

/** The per-grant intent nonce, decoded from the `execute(intent, …)` calldata of the block's transaction. */
async function intentNonce(txHash: string | undefined): Promise<string | null> {
  if (!txHash) return null;
  if (nonceCache.has(txHash)) return nonceCache.get(txHash)!;
  let n: string | null = null;
  try {
    const tx = await getProvider().getTransaction(txHash);
    const parsed = tx ? getGuardReadOnly().interface.parseTransaction({ data: tx.data }) : null;
    if (parsed?.name === "execute") n = String(parsed.args[0].nonce);
  } catch {
    /* not an execute() call (approve/delegate) or node can't serve the tx */
  }
  nonceCache.set(txHash, n);
  return n;
}

/** Block in which the contract was deployed (the "genesis" of this audit chain), found by bisecting eth_getCode. */
async function deployment() {
  const address = config.deployment.address;
  if (deployCache?.address === address) return deployCache.info;
  let info: { blockNumber: number; timestamp: number } | null = null;
  try {
    const provider = getProvider();
    let lo = 0;
    let hi = await provider.getBlockNumber();
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await provider.getCode(address, mid)) === "0x") lo = mid + 1;
      else hi = mid;
    }
    const b = await provider.getBlock(lo);
    if (b) info = { blockNumber: lo, timestamp: b.timestamp };
  } catch {
    /* leave null */
  }
  deployCache = { address, info };
  return info;
}

// ───────────────────────────── Rejections (blocks the gate refused to append) ─────────────────────────────

export interface Rejection {
  at: number;
  grantId: number | null;
  action: string | null;
  reason: string;
}
const rejections: Rejection[] = [];

export function noteRejection(r: Omit<Rejection, "at">) {
  rejections.unshift({ at: Math.floor(Date.now() / 1000), ...r });
  rejections.length = Math.min(rejections.length, 20);
}
export function clearRejections() {
  rejections.length = 0;
}

// ───────────────────────────── Verification ─────────────────────────────

export interface VerifiedBlock extends BlockInspection {
  grantId: number;
  actionId: string;
  actionName: string | null;
  outcome: string | null;
  amount: string;
  paramsHash: string;
  code: number;
  blockNumber: number;
  txHash: string | null;
  timestamp: number | null;
  nonce: string | null;
  /** Values the contract emitted for this index, only for the fields that differ from what is stored. */
  onChain: Record<string, string> | null;
}

const DIFF_TO_ONCHAIN: Record<string, (e: AuditBlockInput) => string> = {
  grant_id: (e) => e.grantId.toString(),
  action_id: (e) => e.actionId,
  amount: (e) => e.amount.toString(),
  params_hash: (e) => e.paramsHash,
  code: (e) => String(e.code),
  block_number: (e) => e.blockNumber.toString(),
  head: (e) => e.head,
};

export async function verifyAuditFromDb(grantId?: number, opts: { sync?: boolean } = {}) {
  if (opts.sync !== false) {
    try {
      await syncNow();
    } catch (e) {
      console.warn("Index sync error in verifyAuditFromDb:", e);
    }
  }
  const db = getDb();
  // The hash chain is global across grants, so it is always verified in full; `grantId` only filters what is returned.
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY index_num ASC").all() as unknown as AuditRow[];

  let truth: Awaited<ReturnType<typeof loadChainTruth>> | null = null;
  try {
    truth = await loadChainTruth();
  } catch (e) {
    console.warn("Could not read on-chain audit truth:", e);
  }
  const onChainHead = truth?.head ?? ZeroHash;

  const inspection = inspectAuditChain(rows.map(rowToBlock), truth);
  const chainByIndex = new Map((truth?.events ?? []).map((e) => [e.index, e]));

  const blocks: VerifiedBlock[] = await Promise.all(
    rows.map(async (r, i) => {
      const b = inspection.blocks[i];
      const chainEvent = chainByIndex.get(r.index_num);
      const txHash = chainEvent ? (truth!.txByIndex.get(r.index_num) ?? null) : r.tx_hash || null;
      const stamp = await blockTimestamp(Number(chainEvent?.blockNumber ?? r.block_number));

      // action_name / outcome are not hashed, so verify them by re-deriving them from the (verified) hashed fields.
      const diffs = [...b.diffs];
      const reasons = [...b.reasons];
      let status = b.status;
      const expectedName = resolveActionName(r.grant_id, r.action_id);
      const expectedOutcome = labelAuditCode(r.code);
      if ((r.action_name ?? null) !== (expectedName ?? null)) {
        diffs.push("action_name");
        reasons.push(`Action name "${r.action_name}" does not match the action id (expected "${expectedName}").`);
        status = "tampered";
      }
      if ((r.outcome ?? null) !== expectedOutcome) {
        diffs.push("outcome");
        reasons.push(`Outcome "${r.outcome}" does not match code ${r.code} (expected "${expectedOutcome}").`);
        status = "tampered";
      }

      const onChain =
        chainEvent && diffs.some((d) => d in DIFF_TO_ONCHAIN)
          ? Object.fromEntries(diffs.filter((d) => d in DIFF_TO_ONCHAIN).map((d) => [d, DIFF_TO_ONCHAIN[d](chainEvent)]))
          : null;

      return {
        ...b,
        diffs,
        reasons,
        status,
        grantId: r.grant_id,
        actionId: r.action_id,
        actionName: r.action_name,
        outcome: r.outcome,
        amount: r.amount,
        paramsHash: r.params_hash,
        code: r.code,
        blockNumber: r.block_number,
        txHash,
        timestamp: stamp,
        nonce: await intentNonce(txHash ?? undefined),
        onChain,
      };
    }),
  );

  const firstBadPosition = blocks.findIndex((b) => b.status !== "ok");
  const brokenAt = firstBadPosition >= 0 ? firstBadPosition : inspection.missing.length ? inspection.missing[0] : inspection.headMatchesChain === false ? Math.max(0, blocks.length - 1) : null;
  const valid = brokenAt === null && inspection.valid;
  const visible = grantId ? blocks.filter((b) => b.grantId === grantId) : blocks;

  return {
    valid,
    entriesChecked: rows.length,
    expectedHead: onChainHead,
    computedHead: rows.length ? rows[rows.length - 1].head : ZeroHash,
    brokenAt,
    onChainHead,
    onChainCount: truth?.count ?? null,
    chainAvailable: !!truth,
    lagging: inspection.lagging,
    missing: inspection.missing,
    headMatchesChain: inspection.headMatchesChain,
    tamperedCount: blocks.filter((b) => b.status !== "ok").length,
    genesis: { head: ZeroHash, address: config.deployment.address, chainId: config.deployment.chainId, deployed: await deployment() },
    grantId: grantId ?? null,
    rejections: [...rejections],
    blocks: visible,
    // Kept for older callers (Audit log page etc.)
    rows: visible.map((b) => ({
      index: b.index,
      grantId: b.grantId,
      actionId: b.actionId,
      actionName: b.actionName,
      outcome: b.outcome,
      amount: b.amount,
      paramsHash: b.paramsHash,
      code: b.code,
      head: b.head,
      blockNumber: b.blockNumber,
      txHash: b.txHash,
    })),
  };
}

export type VerifyReport = Awaited<ReturnType<typeof verifyAuditFromDb>>;

// ───────────────────────────── Integrity gate ─────────────────────────────

export class ChainTamperedError extends Error {
  readonly code = "CHAIN_TAMPERED";
  constructor(
    message: string,
    readonly details: { brokenAt: number | null; blockNumber: number | null; tamperedCount: number; reasons: string[] },
  ) {
    super(message);
  }
}

/** Push the current integrity state to every connected UI (SSE) so all pages update at once. */
export async function publishIntegrity() {
  const r = await verifyAuditFromDb(undefined, { sync: false });
  sse.publish({ type: "integrity", data: { valid: r.valid, brokenAt: r.brokenAt, tamperedCount: r.tamperedCount } });
  return r;
}

/**
 * Called before the relayer appends anything to the audit chain. If the indexed chain no longer matches itself or the
 * on-chain record, refuse to build on top of it.
 */
export async function assertChainIntact(ctx: { grantId?: number; action?: string } = {}) {
  const r = await verifyAuditFromDb();
  if (r.valid) return;
  const bad = r.blocks.find((b) => b.status !== "ok");
  const n = r.brokenAt === null ? null : r.brokenAt + 1;
  const reasons = bad?.reasons ?? (r.missing.length ? [`Block(s) ${r.missing.map((m) => m + 1).join(", ")} deleted.`] : ["Final hash differs from the on-chain auditHead."]);
  const message = `Audit chain integrity check failed at Block #${n ?? "?"}: new blocks are refused until the chain is restored.`;
  noteRejection({ grantId: ctx.grantId ?? null, action: ctx.action ?? null, reason: message });
  sse.publish({ type: "integrity", data: { valid: false, brokenAt: r.brokenAt, tamperedCount: r.tamperedCount, rejected: true } });
  throw new ChainTamperedError(message, { brokenAt: r.brokenAt, blockNumber: n, tamperedCount: r.tamperedCount, reasons });
}

// ───────────────────────────── Dev / demo attacks ─────────────────────────────

export type TamperField = "amount" | "code" | "action_id" | "action_name" | "outcome" | "params_hash" | "block_number" | "grant_id" | "head";

const COLUMN: Record<TamperField, string> = {
  amount: "amount",
  code: "code",
  action_id: "action_id",
  action_name: "action_name",
  outcome: "outcome",
  params_hash: "params_hash",
  block_number: "block_number",
  grant_id: "grant_id",
  head: "head",
};

function coerce(field: TamperField, raw: string | number): string | number {
  const v = String(raw).trim();
  switch (field) {
    case "amount":
      if (!/^\d+$/.test(v)) throw new Error("amount must be a whole number of wei");
      return v;
    case "code":
    case "block_number":
    case "grant_id": {
      if (!/^\d+$/.test(v)) throw new Error(`${field} must be a whole number`);
      const n = Number(v);
      if (field === "code" && n > 255) throw new Error("code must be 0-255");
      return n;
    }
    case "action_id":
    case "params_hash":
    case "head":
      if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${field} must be a 32-byte hex string (0x + 64 hex chars)`);
      return v.toLowerCase();
    default:
      return v;
  }
}

/** Dev/demo: corrupt one or more fields of an indexed audit row (the off-chain copy — the contract is untouched). */
export function tamperAuditRow(indexNum: number, updates: Partial<Record<TamperField, string | number>>) {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM audit_events WHERE index_num = ?").get(indexNum);
  if (!exists) throw new Error(`No audit block with index ${indexNum}`);
  const entries = Object.entries(updates).filter(([k]) => k in COLUMN) as Array<[TamperField, string | number]>;
  if (!entries.length) throw new Error("No valid fields to tamper with");
  const coerced = entries.map(([k, v]) => [k, coerce(k, v)] as const);
  for (const [k, v] of coerced) db.prepare(`UPDATE audit_events SET ${COLUMN[k]} = ? WHERE index_num = ?`).run(v, indexNum);
  return coerced.map(([k]) => k);
}

/** Dev/demo: attacker recomputes hashes after editing so the local chain looks self-consistent again. */
export function remineAuditChain(indexNum: number, mode: "one" | "all") {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY index_num ASC").all() as unknown as AuditRow[];
  const blocks = rows.map(rowToBlock);
  const position = blocks.findIndex((b) => b.index === indexNum);
  if (position < 0) throw new Error(`No audit block with index ${indexNum}`);
  const updates = remineHeads(blocks, position, mode);
  for (const u of updates) db.prepare("UPDATE audit_events SET head = ? WHERE index_num = ?").run(u.head, u.index);
  return updates.length;
}

/** Dev/demo: remove a block from the off-chain copy. */
export function deleteAuditRow(indexNum: number) {
  const r = getDb().prepare("DELETE FROM audit_events WHERE index_num = ?").run(indexNum);
  if (!r.changes) throw new Error(`No audit block with index ${indexNum}`);
}

/** Dev/demo: restore SQLite audit records directly from ground-truth on-chain logs */
export async function restoreAuditFromChain() {
  const { upsertAuditRow } = await import("../providers/mock.js");
  const guard = getGuardReadOnly();
  const filter = guard.filters.AuditAppended();
  const logs = await guard.queryFilter(filter, 0);

  const db = getDb();
  db.prepare("DELETE FROM audit_events").run();

  for (const log of logs) {
    if ((log as any).args) {
      const a = (log as any).args;
      upsertAuditRow({
        indexNum: Number(a.index),
        grantId: Number(a.grantId),
        actionId: a.actionId,
        amount: a.amount.toString(),
        paramsHash: a.paramsHash,
        code: Number(a.code),
        head: a.head,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.index,
      });
    }
  }
  clearRejections();
}
