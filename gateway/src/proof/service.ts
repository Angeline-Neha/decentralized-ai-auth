import {
  actionId,
  actionNameFromId,
  auditOutcomeLabel,
  buildActionTree,
  rootMatches,
  proofFor,
} from "@agentguard/shared";
import { getDb, type ManifestRow } from "../db/index.js";
import { getGuardReadOnly } from "../contract/client.js";

export function saveManifest(grantId: number, actionNames: string[], expectedRoot: string) {
  const tree = buildActionTree(actionNames);
  if (!rootMatches(tree, expectedRoot)) {
    throw new Error(`Manifest root ${tree.root} does not match on-chain root ${expectedRoot}`);
  }
  getDb()
    .prepare(
      `INSERT INTO grant_manifests (grant_id, actions_json, root) VALUES (?, ?, ?)
       ON CONFLICT(grant_id) DO UPDATE SET actions_json = excluded.actions_json, root = excluded.root`,
    )
    .run(grantId, JSON.stringify(actionNames), tree.root);
  return { root: tree.root, actions: actionNames };
}

export function getManifest(grantId: number): { actions: string[]; root: string } | null {
  const row = getDb().prepare("SELECT * FROM grant_manifests WHERE grant_id = ?").get(grantId) as ManifestRow | undefined;
  if (!row) return null;
  return { actions: JSON.parse(row.actions_json) as string[], root: row.root };
}

/** Walk grant → parent chain and collect ids (child first). */
export async function grantChain(grantId: number): Promise<number[]> {
  const chain: number[] = [];
  let id = grantId;
  const guard = getGuardReadOnly();
  while (id !== 0) {
    chain.push(id);
    const g = await guard.getGrant(id);
    id = Number(g.parentId);
  }
  return chain;
}

/** Merkle proofs for each grant in the delegation chain (index 0 = this grant). */
export async function proofsForAction(grantId: number, actionName: string): Promise<string[][]> {
  const ids = await grantChain(grantId);
  const proofs: string[][] = [];
  for (const id of ids) {
    const manifest = getManifest(id);
    if (!manifest) {
      throw new Error(`No manifest uploaded for grant ${id}. POST /grants/${id}/manifest first.`);
    }
    if (!manifest.actions.includes(actionName)) {
      throw new Error(`Action "${actionName}" not in manifest for grant ${id}`);
    }
    const tree = buildActionTree(manifest.actions);
    proofs.push(proofFor(tree, actionName));
  }
  return proofs;
}

export function resolveActionName(grantId: number, actionIdHex: string): string | null {
  const manifest = getManifest(grantId);
  if (!manifest) return null;
  return actionNameFromId(manifest.actions, actionIdHex);
}

export function labelAuditCode(code: number): string {
  return auditOutcomeLabel(code);
}

export { actionId };
