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
