import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZeroHash } from "ethers";
import { actionId, computeAuditHead, inspectAuditChain, remineHeads, type AuditBlockInput, type AuditChainTruth } from "@agentguard/shared";

/** Build a genuine 4-block chain exactly the way the contract does. */
function genuine(): AuditChainTruth {
  const events: AuditBlockInput[] = [];
  let head = ZeroHash;
  const specs = [
    { name: "read_calendar", amount: 0n, code: 0 },
    { name: "send_email", amount: 0n, code: 0 },
    { name: "pay_invoice", amount: 10n ** 16n, code: 0 },
    { name: "transfer_funds", amount: 5n * 10n ** 16n, code: 4 },
  ];
  specs.forEach((s, index) => {
    const e = { grantId: 1n, actionId: actionId(s.name), amount: s.amount, paramsHash: ZeroHash, code: s.code, blockNumber: BigInt(10 + index) };
    head = computeAuditHead(head, e);
    events.push({ ...e, index, head });
  });
  return { events, head, count: events.length };
}
const clone = (rows: AuditBlockInput[]) => rows.map((r) => ({ ...r }));

describe("inspectAuditChain", () => {
  it("accepts an untouched chain", () => {
    const t = genuine();
    const r = inspectAuditChain(clone(t.events), t);
    assert.equal(r.valid, true);
    assert.ok(r.blocks.every((b) => b.status === "ok" && b.hashOk && b.anchored));
  });

  it("editing a block's amount flags exactly that block as tampered", () => {
    const t = genuine();
    const rows = clone(t.events);
    rows[2].amount = 999n;
    const r = inspectAuditChain(rows, t);
    assert.equal(r.valid, false);
    assert.equal(r.firstBadPosition, 2);
    assert.deepEqual(r.blocks.map((b) => b.status), ["ok", "ok", "tampered", "ok"]);
    assert.deepEqual(r.blocks[2].diffs, ["amount"]);
    assert.equal(r.blocks[2].hashOk, false);
  });

  it("attacker re-mines the edited block: the NEXT block's link breaks", () => {
    const t = genuine();
    const rows = clone(t.events);
    rows[1].amount = 777n;
    for (const u of remineHeads(rows, 1, "one")) rows.find((r) => r.index === u.index)!.head = u.head;
    const r = inspectAuditChain(rows, t);
    assert.equal(r.blocks[1].hashOk, true, "re-mined block is self-consistent");
    assert.equal(r.blocks[1].status, "tampered", "...but still differs from on-chain");
    assert.equal(r.blocks[2].status, "broken-link");
    assert.equal(r.valid, false);
  });

  it("attacker re-mines EVERYTHING: local chain is consistent but on-chain anchor still catches it", () => {
    const t = genuine();
    const rows = clone(t.events);
    rows[0].code = 4;
    for (const u of remineHeads(rows, 0, "all")) rows.find((r) => r.index === u.index)!.head = u.head;
    const r = inspectAuditChain(rows, t);
    assert.ok(r.blocks.every((b) => b.hashOk), "every local hash verifies");
    assert.equal(r.headMatchesChain, false);
    assert.equal(r.blocks[0].status, "tampered");
    assert.equal(r.valid, false);
  });

  it("deleting a middle block is detected; a merely-behind index is not tampering", () => {
    const t = genuine();
    const gap = clone(t.events).filter((r) => r.index !== 1);
    const g = inspectAuditChain(gap, t);
    assert.deepEqual(g.missing, [1]);
    assert.equal(g.valid, false);

    const behind = inspectAuditChain(clone(t.events).slice(0, 3), t);
    assert.equal(behind.lagging, true);
    assert.equal(behind.valid, true);
  });

  it("without chain truth it still detects edits via the hash link", () => {
    const t = genuine();
    const rows = clone(t.events);
    rows[3].code = 0;
    const r = inspectAuditChain(rows, null);
    assert.equal(r.valid, false);
    assert.equal(r.blocks[3].status, "tampered");
  });
});
