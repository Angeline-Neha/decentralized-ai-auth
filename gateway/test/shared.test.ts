import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionId,
  buildActionTree,
  computeAuditChain,
  computeAuditHead,
  proofFor,
  verifyAuditChainWithStoredHeads,
} from "@agentguard/shared";
import { keccak256, AbiCoder, ZeroHash } from "ethers";

describe("shared merkle", () => {
  it("builds proofs compatible with OpenZeppelin StandardMerkleTree", () => {
    const tree = buildActionTree(["read_calendar", "send_email"]);
    const proof = proofFor(tree, "read_calendar");
    assert.ok(proof.length >= 1);
    assert.equal(tree.root.startsWith("0x"), true);
    assert.equal(actionId("read_calendar"), actionId("read_calendar"));
  });
});

describe("shared audit chain", () => {
  it("matches contract encoding", () => {
    const coder = AbiCoder.defaultAbiCoder();
    let head = ZeroHash;
    const entry = {
      grantId: 1n,
      actionId: actionId("read_calendar"),
      amount: 0n,
      paramsHash: ZeroHash,
      code: 0,
      blockNumber: 42n,
    };
    head = keccak256(
      coder.encode(
        ["bytes32", "uint256", "bytes32", "uint256", "bytes32", "uint8", "uint256"],
        [head, entry.grantId, entry.actionId, entry.amount, entry.paramsHash, entry.code, entry.blockNumber],
      ),
    );
    const computed = computeAuditHead(ZeroHash, entry);
    assert.equal(computed, head);

    const chain = computeAuditChain([entry]);
    assert.equal(chain, head);
  });

  it("detects tampered stored heads", () => {
    const entry = {
      grantId: 1n,
      actionId: actionId("read_calendar"),
      amount: 0n,
      paramsHash: ZeroHash,
      code: 0,
      blockNumber: 1n,
      storedHead: "0xdead",
    };
    const result = verifyAuditChainWithStoredHeads([entry], "0xdead");
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 0);
  });
});
