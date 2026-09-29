import { verifyAuditChainWithStoredHeads } from "@agentguard/shared";
import { getDb } from "../db/index.js";
import { getGuardReadOnly } from "../contract/client.js";
import { indexHistoricalEvents } from "../indexer/index.js";
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

export async function verifyAuditFromDb(grantId?: number) {
  try {
    await indexHistoricalEvents();
  } catch (e) {
    console.warn("Index historical events error in verifyAuditFromDb:", e);
  }
  const db = getDb();
  const rows = (
    grantId
      ? db
          .prepare("SELECT * FROM audit_events WHERE grant_id = ? ORDER BY index_num ASC")
          .all(grantId)
      : db.prepare("SELECT * FROM audit_events ORDER BY index_num ASC").all()
  ) as unknown as AuditRow[];

  let onChainHead = "0x0000000000000000000000000000000000000000000000000000000000000000";
  try {
    const guard = getGuardReadOnly();
    onChainHead = await guard.auditHead();
  } catch (e) {
    console.warn("Could not read onChainHead:", e);
  }

  const entries = rows.map((r) => ({
    grantId: toBigIntSafe(r.grant_id),
    actionId: r.action_id || "0x0000000000000000000000000000000000000000000000000000000000000000",
    amount: toBigIntSafe(r.amount),
    paramsHash: r.params_hash || "0x0000000000000000000000000000000000000000000000000000000000000000",
    code: Number(r.code) || 0,
    blockNumber: toBigIntSafe(r.block_number),
    storedHead: r.head || "0x0000000000000000000000000000000000000000000000000000000000000000",
  }));

  const result = verifyAuditChainWithStoredHeads(entries, onChainHead);

  return {
    ...result,
    onChainHead,
    grantId: grantId ?? null,
    rows: rows.map((r) => ({
      index: r.index_num,
      grantId: r.grant_id,
      actionId: r.action_id,
      actionName: r.action_name,
      outcome: r.outcome,
      amount: r.amount,
      paramsHash: r.params_hash,
      code: r.code,
      head: r.head,
      blockNumber: r.block_number,
      txHash: r.tx_hash,
    })),
  };
}

/** Dev/demo: corrupt one audit row to show verification failure. */
export function tamperAuditRow(
  indexNum: number,
  field: "amount" | "code" | "action_id" | "action_name" | "head" = "amount",
  value: string | number = "999999999999999999",
) {
  const db = getDb();
  if (field === "amount") {
    db.prepare("UPDATE audit_events SET amount = ? WHERE index_num = ?").run(String(value), indexNum);
  } else if (field === "code") {
    db.prepare("UPDATE audit_events SET code = ? WHERE index_num = ?").run(Number(value), indexNum);
  } else if (field === "action_id") {
    db.prepare("UPDATE audit_events SET action_id = ? WHERE index_num = ?").run(String(value), indexNum);
  } else if (field === "action_name") {
    db.prepare("UPDATE audit_events SET action_name = ? WHERE index_num = ?").run(String(value), indexNum);
  } else if (field === "head") {
    db.prepare("UPDATE audit_events SET head = ? WHERE index_num = ?").run(String(value), indexNum);
  }
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
}
