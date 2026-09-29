import { auditOutcomeLabel } from "@agentguard/shared";
import { getGuardReadOnly, getProvider } from "../contract/client.js";
import { config } from "../config.js";
import { getCursor, getDb, getMeta, setCursor, setMeta, wipeAll, type GrantRow } from "../db/index.js";
import { upsertAuditRow } from "../providers/mock.js";
import { resolveActionName } from "../proof/service.js";
import { sse } from "../sse/broadcaster.js";

const CURSOR = "agentguard";

export async function syncGrantsFromChain(grantId?: number) {
  const guard = getGuardReadOnly();
  let nextId: number;
  try {
    nextId = Number(await guard.nextGrantId());
  } catch {
    // No contract at this address (Ganache restarted / stale deployment file): nothing on-chain, nothing indexed.
    getDb().prepare("DELETE FROM grants").run();
    getDb().prepare("DELETE FROM pending_intents").run();
    return;
  }

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

/**
 * Identity of the chain + contract the DB was built from. If Ganache is restarted (new genesis block),
 * the contract is redeployed, or the gateway is pointed elsewhere, the fingerprint changes and every
 * indexed table is wiped and rebuilt from the chain. This is what stops stale grants/audit rows
 * surviving a restart.
 */
async function computeFingerprint(): Promise<{ fp: string; hasCode: boolean }> {
  const provider = getProvider();
  const [net, genesis, code] = await Promise.all([
    provider.getNetwork(),
    provider.getBlock(0),
    provider.getCode(config.deployment.address),
  ]);
  return {
    fp: `${net.chainId}:${config.deployment.address.toLowerCase()}:${genesis?.hash ?? "?"}`,
    hasCode: code !== "0x",
  };
}

let lastFingerprint: string | null = null;
let contractLive = true;
let lastWarn = 0;

export function isContractLive() {
  return contractLive;
}
let syncing: Promise<void> | null = null;
let syncAgain = false;
let firstSyncDone = false;
let watcher: NodeJS.Timeout | null = null;

export function currentFingerprint() {
  return lastFingerprint;
}

/** Wipe local index and re-read the whole chain history (used on reset / chain change). */
export async function rebuildIndex(reason: string) {
  console.log(`[indexer] rebuilding index: ${reason}`);
  wipeAll();
  firstSyncDone = false;
  await syncNow();
}

async function runSync() {
  const { fp, hasCode } = await computeFingerprint();
  const stored = getMeta("fingerprint");
  const changed = stored !== fp;
  if (changed) {
    if (stored) console.log(`[indexer] chain/contract changed (${stored} -> ${fp}); wiping stale index`);
    wipeAll();
    setMeta("fingerprint", fp);
    firstSyncDone = false;
  }
  const chainChanged = lastFingerprint !== null && lastFingerprint !== fp;
  lastFingerprint = fp;

  contractLive = hasCode;
  if (!hasCode) {
    if (Date.now() - lastWarn > 30_000) {
      lastWarn = Date.now();
      console.error(
        `[indexer] NO CONTRACT CODE at ${config.deployment.address}. Ganache was restarted or the deployment file is stale — click "Reset Demo" (or re-run npm start).`,
      );
    }
    if (changed) sse.publish({ type: "grant", data: { event: "Reset", reason: "no-contract" } });
    return;
  }

  const provider = getProvider();
  const guard = getGuardReadOnly();
  const latest = await provider.getBlockNumber();
  const cur = getCursor(CURSOR);
  const hasCursor = getMeta("cursor_set") === fp;
  let from = hasCursor ? cur.blockNumber + 1 : 0;
  if (from > latest + 1) from = 0; // chain went backwards: re-read everything
  const publish = firstSyncDone; // don't replay history into the live feed

  let touched = false;
  if (from <= latest) {
    const logs = await provider.getLogs({ address: config.deployment.address, fromBlock: from, toBlock: latest });
    for (const log of logs) {
      let parsed;
      try {
        parsed = guard.interface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;
      touched = true;
      const a = parsed.args;
      switch (parsed.name) {
        case "AuditAppended": {
          const row = {
            indexNum: Number(a.index),
            grantId: Number(a.grantId),
            actionId: a.actionId as string,
            amount: (a.amount as bigint).toString(),
            paramsHash: a.paramsHash as string,
            code: Number(a.code),
            head: a.head as string,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            logIndex: log.index,
          };
          upsertAuditRow(row);
          if (publish) {
            sse.publish({
              type: "audit",
              data: {
                index: row.indexNum,
                grantId: row.grantId,
                actionId: row.actionId,
                actionName: resolveActionName(row.grantId, row.actionId),
                amount: row.amount,
                code: row.code,
                outcome: auditOutcomeLabel(row.code),
                head: row.head,
                txHash: row.txHash,
              },
            });
          }
          break;
        }
        case "GrantCreated":
        case "Frozen":
        case "Unfrozen":
        case "Revoked":
        case "ToppedUp":
          if (publish) sse.publish({ type: "grant", data: { grantId: Number(a.grantId), event: parsed.name } });
          break;
        case "Delegated":
          if (publish) sse.publish({ type: "grant", data: { grantId: Number(a.childId), event: "Delegated" } });
          break;
        case "PendingCreated": {
          const pid = Number(a.pendingId);
          const pd = await guard.getPending(pid);
          getDb()
            .prepare(
              `INSERT OR REPLACE INTO pending_intents
               (pending_id, grant_id, nonce, action_id, payee, amount, params_hash, expires_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            )
            .run(pid, Number(a.grantId), Number(a.nonce), a.actionId, a.payee, (a.amount as bigint).toString(), pd.paramsHash, Number(a.expiresAt));
          if (publish) sse.publish({ type: "pending", data: { pendingId: pid, grantId: Number(a.grantId) } });
          break;
        }
        case "PendingApproved":
        case "PendingRejected": {
          const pid = Number(a.pendingId);
          const status = parsed.name === "PendingApproved" ? 2 : 3;
          getDb().prepare("UPDATE pending_intents SET status = ? WHERE pending_id = ?").run(status, pid);
          if (publish) sse.publish({ type: "pending", data: { pendingId: pid, status: parsed.name.replace("Pending", "") } });
          break;
        }
        default:
          break;
      }
    }
    setCursor(CURSOR, latest, 0);
    setMeta("cursor_set", fp);
  }

  if (touched || changed || !firstSyncDone) await syncGrantsFromChain();
  firstSyncDone = true;
  if (chainChanged) sse.publish({ type: "grant", data: { event: "Reset", reason: "chain-changed" } });
}

/** Incremental, single-flight sync. Concurrent callers share one run; a call made mid-run triggers one more. */
export function syncNow(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      do {
        syncAgain = false;
        await runSync();
      } while (syncAgain);
    } catch (e) {
      console.error("[indexer] sync failed:", e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Back-compat name used by routes. Now incremental (does not overwrite existing rows). */
export const indexHistoricalEvents = syncNow;

export async function startIndexer() {
  await syncNow();
  if (watcher) clearInterval(watcher);
  // Polling is more reliable than ethers' filter subscriptions on Ganache, survives redeploys,
  // and also notices Ganache being restarted underneath us.
  watcher = setInterval(() => void syncNow(), 1500);
  watcher.unref?.();
}

export function stopIndexer() {
  if (watcher) clearInterval(watcher);
  watcher = null;
}

/** Called by /dev/reset right after a fresh contract is live: forget everything indexed for the old one. */
export async function adoptFreshDeployment() {
  if (syncing) await syncing;
  const { fp } = await computeFingerprint();
  wipeAll();
  setMeta("fingerprint", fp);
  lastFingerprint = fp;
  firstSyncDone = false;
}
