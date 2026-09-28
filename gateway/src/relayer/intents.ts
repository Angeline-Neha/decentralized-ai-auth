import { ContractTransactionReceipt, verifyTypedData, type TypedDataField } from "ethers";
import { ReasonLabel, INTENT_TYPES } from "@agentguard/shared";
import { getDomain, getGuard, getGuardReadOnly } from "../contract/client.js";
import { actionId, proofsForAction } from "../proof/service.js";
import { runProvider } from "../providers/mock.js";
import { sse } from "../sse/broadcaster.js";
import { syncGrantsFromChain } from "../indexer/index.js";

export interface IntentRequest {
  grantId: number;
  action: string;
  payee?: string;
  amount?: string;
  paramsHash?: string;
  nonce?: number;
  deadline?: number;
  signature: string;
  params?: Record<string, unknown>;
}

export interface IntentResult {
  txHash: string;
  outcome: "Executed" | "Denied" | "Pending" | "Reverted";
  reason?: string;
  reasonCode?: number;
  providerResult?: unknown;
  blockNumber?: number;
}

function decodeRevert(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("BadNonce")) return "BadNonce";
  if (msg.includes("BadSignature")) return "BadSignature";
  if (msg.includes("IntentExpired")) return "IntentExpired";
  return msg.slice(0, 200);
}

export async function relayIntent(req: IntentRequest): Promise<IntentResult> {
  const guard = getGuard();
  const read = getGuardReadOnly();
  const domain = await getDomain();

  const grant = await read.getGrant(req.grantId);
  if (grant.owner === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Grant ${req.grantId} not found`);
  }

  const actionIdValue = actionId(req.action);

  const intent = {
    grantId: BigInt(req.grantId),
    actionId: actionIdValue,
    payee: req.payee ?? "0x0000000000000000000000000000000000000000",
    amount: BigInt(req.amount ?? "0"),
    paramsHash: req.paramsHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    nonce: BigInt(req.nonce ?? (await read.nonces(req.grantId))),
    deadline: BigInt(req.deadline ?? Math.floor(Date.now() / 1000) + 3600),
  };

  // Pre-check signature (relayer is not the judge for policy, but must reject garbage).
  const recovered = verifyTypedData(
    domain,
    INTENT_TYPES as unknown as Record<string, TypedDataField[]>,
    intent,
    req.signature,
  );

  if (recovered.toLowerCase() !== grant.agent.toLowerCase()) {
    throw new Error("Invalid agent signature");
  }
  if (intent.deadline < BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("Intent expired");
  }

  const proofs = await proofsForAction(req.grantId, req.action);

  let receipt: ContractTransactionReceipt;
  try {
    const tx = await guard.execute(intent, req.signature, proofs);
    receipt = await tx.wait();
  } catch (err) {
    const reason = decodeRevert(err);
    sse.publish({ type: "intent", data: { grantId: req.grantId, action: req.action, outcome: "Reverted", reason } });
    return { txHash: "", outcome: "Reverted", reason };
  }

  if (!receipt) throw new Error("Transaction failed");

  await syncGrantsFromChain(req.grantId);

  const denied = receipt.logs
    .map((l) => {
      try {
        return guard.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "Denied");

  if (denied) {
    const code = Number(denied.args.reason);
    const result: IntentResult = {
      txHash: receipt.hash,
      outcome: "Denied",
      reason: ReasonLabel[code] ?? `Reason(${code})`,
      reasonCode: code,
      blockNumber: receipt.blockNumber,
    };
    sse.publish({ type: "intent", data: { ...result, grantId: req.grantId, action: req.action } });
    return result;
  }

  const pending = receipt.logs
    .map((l) => {
      try {
        return guard.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "PendingCreated");

  if (pending) {
    const result: IntentResult = {
      txHash: receipt.hash,
      outcome: "Pending",
      blockNumber: receipt.blockNumber,
    };
    sse.publish({ type: "intent", data: { ...result, grantId: req.grantId, action: req.action } });
    return result;
  }

  const executed = receipt.logs
    .map((l) => {
      try {
        return guard.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "Executed");

  if (executed) {
    const providerResult = await runProvider(req.action, req.params ?? {}, {
      grantId: req.grantId,
      nonce: Number(intent.nonce),
      amount: intent.amount.toString(),
      payee: intent.payee === "0x0000000000000000000000000000000000000000" ? null : intent.payee,
      paramsHash: intent.paramsHash,
      txHash: receipt.hash,
    });
    const result: IntentResult = {
      txHash: receipt.hash,
      outcome: "Executed",
      providerResult,
      blockNumber: receipt.blockNumber,
    };
    sse.publish({
      type: "provider",
      data: { grantId: req.grantId, action: req.action, result: providerResult, txHash: receipt.hash },
    });
    sse.publish({ type: "intent", data: { ...result, grantId: req.grantId, action: req.action } });
    return result;
  }

  return { txHash: receipt.hash, outcome: "Denied", reason: "Unknown", blockNumber: receipt.blockNumber };
}

export interface DelegationRequest {
  delegation: {
    parentId: number;
    childAgent: string;
    policy: {
      actionsRoot: string;
      perCallCap: string;
      totalBudget: string;
      maxCallsPerWindow: number;
      windowSeconds: number;
      expiry: number;
      approvalThreshold: string;
      maxStrikes: number;
    };
    escrowShare: string;
    nonce: number;
    deadline: number;
  };
  signature: string;
}

export async function relayDelegation(req: DelegationRequest) {
  const guard = getGuard();
  const d = {
    parentId: BigInt(req.delegation.parentId),
    childAgent: req.delegation.childAgent,
    policy: {
      actionsRoot: req.delegation.policy.actionsRoot,
      perCallCap: BigInt(req.delegation.policy.perCallCap),
      totalBudget: BigInt(req.delegation.policy.totalBudget),
      maxCallsPerWindow: req.delegation.policy.maxCallsPerWindow,
      windowSeconds: BigInt(req.delegation.policy.windowSeconds),
      expiry: BigInt(req.delegation.policy.expiry),
      approvalThreshold: BigInt(req.delegation.policy.approvalThreshold),
      maxStrikes: req.delegation.policy.maxStrikes,
    },
    escrowShare: BigInt(req.delegation.escrowShare),
    nonce: BigInt(req.delegation.nonce),
    deadline: BigInt(req.delegation.deadline),
  };
  const tx = await guard.delegate(d, req.signature);
  const receipt = await tx.wait();
  await syncGrantsFromChain();
  return { txHash: receipt?.hash, childId: receipt ? await parseChildId(receipt) : 0 };
}

async function parseChildId(receipt: ContractTransactionReceipt): Promise<number> {
  const guard = getGuard();
  for (const log of receipt.logs) {
    try {
      const p = guard.interface.parseLog(log);
      if (p?.name === "Delegated") return Number(p.args.childId);
    } catch {
      /* skip */
    }
  }
  return 0;
}
