import { verifyAuditChainWithStoredHeads } from "@agentguard/shared";
import { getDb } from "../db/index.js";
import { getGuardReadOnly } from "../contract/client.js";
import { indexHistoricalEvents } from "../indexer/index.js";
import type { AuditRow } from "../db/index.js";

export async function verifyAuditFromDb(grantId?: number) {
  await indexHistoricalEvents();
  const db = getDb();
  const rows = (
    grantId
      ? db
          .prepare("SELECT * FROM audit_events WHERE grant_id = ? ORDER BY index_num ASC")
          .all(grantId)
      : db.prepare("SELECT * FROM audit_events ORDER BY index_num ASC").all()
  ) as unknown as AuditRow[];

  const guard = getGuardReadOnly();
  const onChainHead = await guard.auditHead();

  const entries = rows.map((r) => ({
    grantId: BigInt(r.grant_id),
    actionId: r.action_id,
    amount: BigInt(r.amount),
    paramsHash: r.params_hash,
    code: r.code,
    blockNumber: BigInt(r.block_number),
    storedHead: r.head,
  }));

  const result = verifyAuditChainWithStoredHeads(entries, onChainHead);

  return {
    ...result,
    onChainHead,
    grantId: grantId ?? null,
    rows: rows.map((r) => ({
      index: r.index_num,
      grantId: r.grant_id,
      actionName: r.action_name,
      outcome: r.outcome,
      head: r.head,
      blockNumber: r.block_number,
    })),
  };
}

/** Dev/demo: corrupt one audit row to show verification failure. */
export function tamperAuditRow(indexNum: number, field: "amount" | "code", value: string | number) {
  const db = getDb();
  if (field === "amount") {
    db.prepare("UPDATE audit_events SET amount = ? WHERE index_num = ?").run(value, indexNum);
  } else {
    db.prepare("UPDATE audit_events SET code = ? WHERE index_num = ?").run(value, indexNum);
  }
}
