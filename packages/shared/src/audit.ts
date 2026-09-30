import { AbiCoder, keccak256, ZeroHash } from "ethers";

const coder = AbiCoder.defaultAbiCoder();

export interface AuditLinkInput {
  grantId: bigint;
  actionId: string;
  amount: bigint;
  paramsHash: string;
  code: number;
  blockNumber: bigint;
}

/** Recompute one step of the on-chain audit hash chain. */
export function computeAuditHead(prevHead: string, entry: AuditLinkInput): string {
  return keccak256(
    coder.encode(
      ["bytes32", "uint256", "bytes32", "uint256", "bytes32", "uint8", "uint256"],
      [prevHead, entry.grantId, entry.actionId, entry.amount, entry.paramsHash, entry.code, entry.blockNumber],
    ),
  );
}

/** Walk an ordered list of audit entries and return the final head. */
export function computeAuditChain(entries: AuditLinkInput[]): string {
  let head = ZeroHash;
  for (const e of entries) {
    head = computeAuditHead(head, e);
  }
  return head;
}

export interface AuditVerifyResult {
  valid: boolean;
  entriesChecked: number;
  expectedHead: string;
  computedHead: string;
  brokenAt: number | null;
}

/** Verify a sequence; returns the index of the first broken link, if any. */
export function verifyAuditChain(entries: AuditLinkInput[], expectedHead: string): AuditVerifyResult {
  let head = ZeroHash;
  for (let i = 0; i < entries.length; i++) {
    head = computeAuditHead(head, entries[i]);
    if (head.toLowerCase() !== expectedHead.toLowerCase() && i === entries.length - 1) {
      // only compare at end unless we have per-row stored heads
    }
  }
  const valid = head.toLowerCase() === expectedHead.toLowerCase();
  let brokenAt: number | null = null;
  if (!valid) {
    head = ZeroHash;
    for (let i = 0; i < entries.length; i++) {
      head = computeAuditHead(head, entries[i]);
      // If caller stored per-row heads, compare incrementally
      const row = entries[i] as AuditLinkInput & { storedHead?: string };
      if (row.storedHead && head.toLowerCase() !== row.storedHead.toLowerCase()) {
        brokenAt = i;
        break;
      }
    }
    if (brokenAt === null) brokenAt = entries.length - 1;
  }
  return {
    valid,
    entriesChecked: entries.length,
    expectedHead,
    computedHead: head,
    brokenAt,
  };
}

/** Verify using per-row stored heads (as emitted by AuditAppended). */
export function verifyAuditChainWithStoredHeads(
  entries: Array<AuditLinkInput & { storedHead: string }>,
  expectedHead: string,
): AuditVerifyResult {
  let head = ZeroHash;
  let brokenAt: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    head = computeAuditHead(head, entries[i]);
    if (head.toLowerCase() !== entries[i].storedHead.toLowerCase()) {
      brokenAt = i;
      break;
    }
  }
  const valid = brokenAt === null && head.toLowerCase() === expectedHead.toLowerCase();
  return {
    valid,
    entriesChecked: entries.length,
    expectedHead,
    computedHead: head,
    brokenAt,
  };
}

// ───────────────────────────── Block-level inspection ─────────────────────────────
// Used by the gateway (integrity gate + /audit/verify) and mirrored by the block visualizer.

/** One audit "block" as stored off-chain (or emitted on-chain in `AuditAppended`). */
export interface AuditBlockInput extends AuditLinkInput {
  index: number;
  head: string;
}

/** Ground truth read from the contract: every `AuditAppended` event plus the live `auditHead`. */
export interface AuditChainTruth {
  events: AuditBlockInput[];
  head: string;
  count: number;
}

export type BlockStatus = "ok" | "tampered" | "broken-link";

export interface BlockInspection {
  position: number;
  index: number;
  /** Stored head of the previous block (ZeroHash for the first block). */
  prevHash: string;
  /** Stored head of this block. */
  head: string;
  /** keccak(prevHash || fields) recomputed from what is stored right now. */
  recomputedHead: string;
  /** stored head === recomputedHead */
  hashOk: boolean;
  /** Matches the on-chain event for this index (null when no chain truth is available). */
  anchored: boolean | null;
  /** Names of fields whose stored value differs from the on-chain event. */
  diffs: string[];
  status: BlockStatus;
  reasons: string[];
}

export interface ChainInspection {
  valid: boolean;
  /** Position (0-based, within the rows passed in) of the first block that is not "ok". */
  firstBadPosition: number | null;
  blocks: BlockInspection[];
  /** On-chain indices that are absent from the local store even though later blocks exist (deleted blocks). */
  missing: number[];
  /** Local store is simply behind the chain (latest blocks not indexed yet). Not tampering. */
  lagging: boolean;
  /** Final stored head equals the contract's auditHead (null when not comparable). */
  headMatchesChain: boolean | null;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function fieldDiffs(a: AuditBlockInput, b: AuditBlockInput): string[] {
  const d: string[] = [];
  if (a.grantId !== b.grantId) d.push("grant_id");
  if (!eq(a.actionId, b.actionId)) d.push("action_id");
  if (a.amount !== b.amount) d.push("amount");
  if (!eq(a.paramsHash, b.paramsHash)) d.push("params_hash");
  if (a.code !== b.code) d.push("code");
  if (a.blockNumber !== b.blockNumber) d.push("block_number");
  if (!eq(a.head, b.head)) d.push("head");
  return d;
}

/**
 * Inspect a locally stored chain block by block.
 *
 *  - hashOk:   the block's own stored hash matches its content + the *stored* hash of the block before it.
 *              (an edited block fails here; a block whose predecessor was edited also fails here)
 *  - anchored: the block equals the on-chain `AuditAppended` event. This is what still catches an attacker who
 *              recomputes ("re-mines") every hash so the local chain is self-consistent.
 *
 * status:
 *   tampered    — content differs from on-chain, or (without chain truth) its own hash does not verify
 *   broken-link — the block itself is untouched but the block before it changed, so its link no longer verifies
 */
export function inspectAuditChain(rows: AuditBlockInput[], truth: AuditChainTruth | null): ChainInspection {
  const byIndex = new Map<number, AuditBlockInput>();
  for (const e of truth?.events ?? []) byIndex.set(e.index, e);

  const blocks: BlockInspection[] = [];
  let prev = ZeroHash;
  rows.forEach((row, position) => {
    const recomputedHead = computeAuditHead(prev, row);
    const hashOk = eq(recomputedHead, row.head);
    const onChain = byIndex.get(row.index);
    let anchored: boolean | null = null;
    let diffs: string[] = [];
    if (truth) {
      if (onChain) {
        diffs = fieldDiffs(row, onChain);
        anchored = diffs.length === 0;
      } else {
        anchored = false;
        diffs = ["not_on_chain"];
      }
    }

    const reasons: string[] = [];
    let status: BlockStatus = "ok";
    if (anchored === false) {
      status = "tampered";
      reasons.push(
        diffs[0] === "not_on_chain"
          ? "This block does not exist on-chain (fabricated)."
          : `Differs from the on-chain record: ${diffs.join(", ")}.`,
      );
    }
    if (!hashOk) {
      if (anchored === true) {
        status = "broken-link";
        reasons.push("Block is intact, but the previous block's hash changed so this link no longer verifies.");
      } else {
        status = "tampered";
        reasons.push("Stored hash does not match the block's contents.");
      }
    }

    blocks.push({ position, index: row.index, prevHash: prev, head: row.head, recomputedHead, hashOk, anchored, diffs, status, reasons });
    prev = row.head;
  });

  // Deleted blocks: an on-chain index below the highest stored index that is absent locally.
  const have = new Set(rows.map((r) => r.index));
  const maxIndex = rows.length ? Math.max(...rows.map((r) => r.index)) : -1;
  const missing: number[] = [];
  if (truth) for (let i = 0; i < maxIndex; i++) if (!have.has(i)) missing.push(i);

  const lagging = !!truth && missing.length === 0 && rows.length < truth.count;
  const last = rows[rows.length - 1];
  const headMatchesChain = truth && rows.length === truth.count ? (last ? eq(last.head, truth.head) : eq(ZeroHash, truth.head)) : null;

  const firstBad = blocks.find((b) => b.status !== "ok");
  const valid = !firstBad && missing.length === 0 && headMatchesChain !== false;
  return { valid, firstBadPosition: firstBad ? firstBad.position : missing.length ? 0 : null, blocks, missing, lagging, headMatchesChain };
}

/**
 * What an attacker does after editing a block: recompute hashes so the local chain looks consistent again.
 * mode "one" fixes only `fromPosition`; "all" also re-links every block after it. Returns the new heads.
 */
export function remineHeads(rows: AuditBlockInput[], fromPosition: number, mode: "one" | "all"): Array<{ index: number; head: string }> {
  const out: Array<{ index: number; head: string }> = [];
  let prev = fromPosition > 0 ? rows[fromPosition - 1].head : ZeroHash;
  const end = mode === "one" ? fromPosition + 1 : rows.length;
  for (let p = fromPosition; p < end && p < rows.length; p++) {
    const head = computeAuditHead(prev, rows[p]);
    out.push({ index: rows[p].index, head });
    prev = head;
  }
  return out;
}
