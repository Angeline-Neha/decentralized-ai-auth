import { keccak256, toUtf8Bytes } from "ethers";

/** keccak256(utf8(name)) — matches ethers.id / contract actionId convention. */
export function actionId(name: string): string {
  return keccak256(toUtf8Bytes(name));
}

export { StandardMerkleTree } from "@openzeppelin/merkle-tree";
export type { StandardMerkleTree as ActionTree } from "@openzeppelin/merkle-tree";
import type { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { StandardMerkleTree as Tree } from "@openzeppelin/merkle-tree";

/** Build an OpenZeppelin StandardMerkleTree over action ids (bytes32 leaves). */
export function buildActionTree(actionNames: string[]): StandardMerkleTree<[string]> {
  const leaves = actionNames.map((n) => [actionId(n)] as [string]);
  return Tree.of(leaves, ["bytes32"]);
}

export function proofFor(tree: StandardMerkleTree<[string]>, actionName: string): string[] {
  return tree.getProof([actionId(actionName)]);
}

export function rootMatches(tree: StandardMerkleTree<[string]>, onChainRoot: string): boolean {
  return tree.root.toLowerCase() === onChainRoot.toLowerCase();
}

/** Resolve a human-readable action name from its id using a manifest list. */
export function actionNameFromId(actionNames: string[], id: string): string | null {
  const hit = actionNames.find((n) => actionId(n).toLowerCase() === id.toLowerCase());
  return hit ?? null;
}
