import { Contract, EventLog, Log } from "ethers";
import { auditOutcomeLabel } from "@agentguard/shared";
import { getGuardReadOnly } from "../contract/client.js";
import { getCursor, getDb, setCursor, type GrantRow } from "../db/index.js";
import { upsertAuditRow } from "../providers/mock.js";
import { resolveActionName } from "../proof/service.js";
import { sse } from "../sse/broadcaster.js";

const CURSOR = "agentguard";

function isEventLog(log: Log | EventLog): log is EventLog {
  return (log as EventLog).args !== undefined;
}

export async function syncGrantsFromChain(grantId?: number) {
  const guard = getGuardReadOnly();
  const nextId = Number(await guard.nextGrantId());
  
  if (!grantId) {
    // If running full sync, remove any grants that don't exist on-chain anymore
    getDb().prepare("DELETE FROM grants WHERE id >= ?").run(nextId);
    getDb().prepare("DELETE FROM grant_manifests WHERE grant_id >= ?").run(nextId);
    getDb().prepare("DELETE FROM pending_intents WHERE grant_id >= ?").run(nextId);
  }

  const start = grantId ?? 1;
  for (let id = start; id < nextId; id++) {
    const g = await guard.getGrant(id);
    if (g.owner === "0x0000000000000000000000000000000000000000") continue;
    upsertGrantRow({
      id,
      owner: g.owner,
      agent: g.agent,
      parent_id: Number(g.parentId),
      actions_root: g.actionsRoot,
      per_call_cap: g.perCallCap.toString(),
      total_budget: g.totalBudget.toString(),
      spent: g.spent.toString(),
      escrow: g.escrow.toString(),
      approval_threshold: g.approvalThreshold.toString(),
      window_seconds: Number(g.windowSeconds),
      window_start: Number(g.windowStart),
      expiry: Number(g.expiry),
      max_calls_per_window: Number(g.maxCallsPerWindow),
      calls_in_window: Number(g.callsInWindow),
      strikes: Number(g.strikes),
      max_strikes: Number(g.maxStrikes),
      depth: Number(g.depth),
      status: Number(g.status),
    });
  }
}

export function upsertGrantRow(row: Omit<GrantRow, "updated_at">) {
  getDb()
    .prepare(
      `INSERT INTO grants (id, owner, agent, parent_id, actions_root, per_call_cap, total_budget, spent, escrow,
        approval_threshold, window_seconds, window_start, expiry, max_calls_per_window, calls_in_window,
        strikes, max_strikes, depth, status, updated_at)
       VALUES (@id, @owner, @agent, @parent_id, @actions_root, @per_call_cap, @total_budget, @spent, @escrow,
        @approval_threshold, @window_seconds, @window_start, @expiry, @max_calls_per_window, @calls_in_window,
        @strikes, @max_strikes, @depth, @status, strftime('%s','now'))
       ON CONFLICT(id) DO UPDATE SET
        owner=excluded.owner, agent=excluded.agent, parent_id=excluded.parent_id, actions_root=excluded.actions_root,
        per_call_cap=excluded.per_call_cap, total_budget=excluded.total_budget, spent=excluded.spent, escrow=excluded.escrow,
        approval_threshold=excluded.approval_threshold, window_seconds=excluded.window_seconds, window_start=excluded.window_start,
        expiry=excluded.expiry, max_calls_per_window=excluded.max_calls_per_window, calls_in_window=excluded.calls_in_window,
        strikes=excluded.strikes, max_strikes=excluded.max_strikes, depth=excluded.depth, status=excluded.status,
        updated_at=strftime('%s','now')`,
    )
    .run(row);
}

export async function indexHistoricalEvents() {
  const guard = getGuardReadOnly();
  const filter = guard.filters.AuditAppended();
  const logs = await guard.queryFilter(filter, 0);

  // Prune any stale audit rows if contract was redeployed with fewer events
  getDb().prepare("DELETE FROM audit_events WHERE index_num >= ?").run(logs.length);

  for (const log of logs) {
    if (!isEventLog(log)) continue;
    const a = log.args;
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

  await syncGrantsFromChain();
}

export async function startIndexer() {
  const guard = getGuardReadOnly();
  await indexHistoricalEvents();

  guard.on("AuditAppended", (...args: unknown[]) => {
    const event = args[args.length - 1] as EventLog;
    const a = event.args;
    upsertAuditRow({
      indexNum: Number(a.index),
      grantId: Number(a.grantId),
      actionId: a.actionId,
      amount: a.amount.toString(),
      paramsHash: a.paramsHash,
      code: Number(a.code),
      head: a.head,
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      logIndex: event.index,
    });
    setCursor(CURSOR, event.blockNumber, event.index);
    sse.publish({
      type: "audit",
      data: {
        index: Number(a.index),
        grantId: Number(a.grantId),
        actionId: a.actionId,
        actionName: resolveActionName(Number(a.grantId), a.actionId),
        amount: a.amount.toString(),
        code: Number(a.code),
        outcome: auditOutcomeLabel(Number(a.code)),
        head: a.head,
        txHash: event.transactionHash,
      },
    });
    void syncGrantsFromChain(Number(a.grantId));
  });

  guard.on("GrantCreated", (...args: unknown[]) => {
    const event = args[args.length - 1] as EventLog;
    const grantId = Number(event.args.grantId);
    void syncGrantsFromChain(grantId);
    sse.publish({ type: "grant", data: { grantId, event: "GrantCreated" } });
  });

  guard.on("PendingCreated", (...args: unknown[]) => {
    const event = args[args.length - 1] as EventLog;
    const a = event.args;
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO pending_intents
         (pending_id, grant_id, nonce, action_id, payee, amount, params_hash, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        Number(a.pendingId),
        Number(a.grantId),
        Number(a.nonce),
        a.actionId,
        a.payee,
        a.amount.toString(),
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        Number(a.expiresAt),
      );
    sse.publish({ type: "pending", data: { pendingId: Number(a.pendingId), grantId: Number(a.grantId) } });
  });

  guard.on("PendingApproved", (...args: unknown[]) => {
    const pendingId = Number((args[args.length - 1] as EventLog).args.pendingId);
    getDb().prepare("UPDATE pending_intents SET status = 2 WHERE pending_id = ?").run(pendingId);
    sse.publish({ type: "pending", data: { pendingId, status: "Approved" } });
  });

  guard.on("PendingRejected", (...args: unknown[]) => {
    const pendingId = Number((args[args.length - 1] as EventLog).args.pendingId);
    getDb().prepare("UPDATE pending_intents SET status = 3 WHERE pending_id = ?").run(pendingId);
    sse.publish({ type: "pending", data: { pendingId, status: "Rejected" } });
  });

  guard.on("Frozen", (...args: unknown[]) => {
    const grantId = Number((args[args.length - 1] as EventLog).args.grantId);
    void syncGrantsFromChain(grantId);
    sse.publish({ type: "grant", data: { grantId, event: "Frozen" } });
  });

  guard.on("Revoked", (...args: unknown[]) => {
    const grantId = Number((args[args.length - 1] as EventLog).args.grantId);
    void syncGrantsFromChain(grantId);
    sse.publish({ type: "grant", data: { grantId, event: "Revoked" } });
  });
}
