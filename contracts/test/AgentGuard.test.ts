import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// Must mirror `enum Reason` in AgentGuard.sol
const Reason = {
  None: 0,
  Frozen: 1,
  Revoked: 2,
  Expired: 3,
  ActionNotAllowed: 4,
  OverCap: 5,
  RateLimit: 6,
  OverBudget: 7,
  InsufficientEscrow: 8,
};

const INTENT_TYPES = {
  Intent: [
    { name: "grantId", type: "uint256" },
    { name: "actionId", type: "bytes32" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paramsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const actionId = (name: string) => ethers.id(name); // keccak256(utf8(name))
const eth = ethers.parseEther;

async function setup(overrides: Record<string, any> = {}, escrow = eth("1")) {
  const [owner, agent, relayer, payee, attacker, stranger] = await ethers.getSigners();
  const guard = await (await ethers.getContractFactory("AgentGuard")).deploy();

  const names = ["read_calendar", "send_email", "pay_invoice"];
  const tree = StandardMerkleTree.of(names.map((n) => [actionId(n)]), ["bytes32"]);
  const now = await time.latest();

  const params = {
    agent: agent.address,
    actionsRoot: tree.root,
    perCallCap: eth("0.1"),
    totalBudget: eth("0.3"),
    maxCallsPerWindow: 5,
    windowSeconds: 3600,
    expiry: now + 86400,
    approvalThreshold: ethers.MaxUint256,
    maxStrikes: 3,
    ...overrides,
  };
  await guard.connect(owner).createGrant(params, { value: escrow });
  const grantId = 1n;
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "AgentGuard",
    version: "1",
    chainId,
    verifyingContract: await guard.getAddress(),
  };
  return { guard, owner, agent, relayer, payee, attacker, stranger, tree, grantId, domain };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

function proofFor(ctx: Ctx, action: string): string[] {
  try {
    return ctx.tree.getProof([actionId(action)]);
  } catch {
    return []; // action not in tree -> attacker has no valid proof
  }
}

/** Builds, signs and submits one intent. Returns the tx promise. */
async function send(
  ctx: Ctx,
  o: {
    action: string;
    amount?: bigint;
    payee?: string;
    nonce?: bigint;
    deadline?: number;
    signer?: any;
    paramsHash?: string;
  },
) {
  const intent = {
    grantId: ctx.grantId,
    actionId: actionId(o.action),
    payee: o.payee ?? ethers.ZeroAddress,
    amount: o.amount ?? 0n,
    paramsHash: o.paramsHash ?? ethers.ZeroHash,
    nonce: o.nonce ?? (await ctx.guard.nonces(ctx.grantId)),
    deadline: o.deadline ?? (await time.latest()) + 3600,
  };
  const signer = o.signer ?? ctx.agent;
  const sig = await signer.signTypedData(ctx.domain, INTENT_TYPES, intent);
  return ctx.guard.connect(ctx.relayer).execute(intent, sig, [proofFor(ctx, o.action)]);
}

describe("AgentGuard", () => {
  describe("grant creation", () => {
    it("stores the policy and escrow", async () => {
      const ctx = await setup();
      const g = await ctx.guard.getGrant(ctx.grantId);
      expect(g.owner).to.equal(ctx.owner.address);
      expect(g.agent).to.equal(ctx.agent.address);
      expect(g.escrow).to.equal(eth("1"));
      expect(g.actionsRoot).to.equal(ctx.tree.root);
      expect(g.status).to.equal(0); // Active
    });

    it("rejects invalid params", async () => {
      const ctx = await setup();
      const bad = {
        agent: ethers.ZeroAddress,
        actionsRoot: ctx.tree.root,
        perCallCap: 1,
        totalBudget: 1,
        maxCallsPerWindow: 1,
        windowSeconds: 1,
        expiry: (await time.latest()) + 100,
        approvalThreshold: 0,
        maxStrikes: 1,
      };
      await expect(ctx.guard.createGrant(bad)).to.be.revertedWithCustomError(ctx.guard, "InvalidParams");
    });
  });

  describe("allowed actions", () => {
    it("executes a whitelisted off-chain action and logs it", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "read_calendar" }))
        .to.emit(ctx.guard, "Executed")
        .withArgs(ctx.grantId, 0n, actionId("read_calendar"), ethers.ZeroAddress, 0n);
      expect(await ctx.guard.nonces(ctx.grantId)).to.equal(1n);
    });

    it("pays from escrow and updates accounting", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "pay_invoice", amount: eth("0.05"), payee: ctx.payee.address }))
        .to.changeEtherBalance(ctx.payee, eth("0.05"));
      const g = await ctx.guard.getGrant(ctx.grantId);
      expect(g.spent).to.equal(eth("0.05"));
      expect(g.escrow).to.equal(eth("0.95"));
    });
  });

  describe("denials and circuit breaker", () => {
    it("denies a non-whitelisted action WITHOUT reverting and adds a strike", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "transfer_funds", amount: eth("0.05"), payee: ctx.attacker.address }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 0n, actionId("transfer_funds"), Reason.ActionNotAllowed, 1);
      expect((await ctx.guard.getGrant(ctx.grantId)).strikes).to.equal(1);
      // attacker got nothing
      expect((await ctx.guard.getGrant(ctx.grantId)).escrow).to.equal(eth("1"));
    });

    it("denies over the per-call cap", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "pay_invoice", amount: eth("0.2"), payee: ctx.payee.address }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 0n, actionId("pay_invoice"), Reason.OverCap, 1);
    });

    it("denies over the total budget", async () => {
      const ctx = await setup({ totalBudget: eth("0.15") });
      await send(ctx, { action: "pay_invoice", amount: eth("0.1"), payee: ctx.payee.address });
      await expect(send(ctx, { action: "pay_invoice", amount: eth("0.1"), payee: ctx.payee.address }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 1n, actionId("pay_invoice"), Reason.OverBudget, 1);
    });

    it("enforces the rate limit and resets after the window", async () => {
      const ctx = await setup({ maxCallsPerWindow: 2 });
      await send(ctx, { action: "read_calendar" });
      await send(ctx, { action: "read_calendar" });
      await expect(send(ctx, { action: "read_calendar" }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 2n, actionId("read_calendar"), Reason.RateLimit, 1);

      await time.increase(3601);
      await expect(send(ctx, { action: "read_calendar" })).to.emit(ctx.guard, "Executed");
    });

    it("freezes after maxStrikes, blocks legit calls, and owner can unfreeze", async () => {
      const ctx = await setup();
      await send(ctx, { action: "evil_1" });
      await send(ctx, { action: "evil_2" });
      await expect(send(ctx, { action: "evil_3" })).to.emit(ctx.guard, "Frozen").withArgs(ctx.grantId);
      expect((await ctx.guard.getGrant(ctx.grantId)).status).to.equal(1); // Frozen

      // legit call is now blocked, and does not add further strikes
      await expect(send(ctx, { action: "read_calendar" }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 3n, actionId("read_calendar"), Reason.Frozen, 3);

      await expect(ctx.guard.connect(ctx.stranger).unfreeze(ctx.grantId)).to.be.revertedWithCustomError(
        ctx.guard,
        "NotGrantOwner",
      );
      await ctx.guard.connect(ctx.owner).unfreeze(ctx.grantId);
      await expect(send(ctx, { action: "read_calendar" })).to.emit(ctx.guard, "Executed");
    });

    it("denies (without a strike) once the grant has expired", async () => {
      const ctx = await setup();
      await time.increase(86401);
      await expect(send(ctx, { action: "read_calendar" }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 0n, actionId("read_calendar"), Reason.Expired, 0);
    });

    it("denies (without a strike) when escrow cannot cover the payment", async () => {
      const ctx = await setup({}, eth("0.01"));
      await expect(send(ctx, { action: "pay_invoice", amount: eth("0.05"), payee: ctx.payee.address }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 0n, actionId("pay_invoice"), Reason.InsufficientEscrow, 0);
    });
  });

  describe("signatures, nonces and replay protection", () => {
    it("reverts a replayed signature (no strike)", async () => {
      const ctx = await setup();
      const intent = {
        grantId: ctx.grantId,
        actionId: actionId("read_calendar"),
        payee: ethers.ZeroAddress,
        amount: 0n,
        paramsHash: ethers.ZeroHash,
        nonce: 0n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await ctx.agent.signTypedData(ctx.domain, INTENT_TYPES, intent);
      const proofs = [proofFor(ctx, "read_calendar")];
      await ctx.guard.connect(ctx.relayer).execute(intent, sig, proofs);
      await expect(ctx.guard.connect(ctx.relayer).execute(intent, sig, proofs)).to.be.revertedWithCustomError(
        ctx.guard,
        "BadNonce",
      );
      expect((await ctx.guard.getGrant(ctx.grantId)).strikes).to.equal(0);
    });

    it("reverts a signature from anyone but the agent", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "read_calendar", signer: ctx.attacker })).to.be.revertedWithCustomError(
        ctx.guard,
        "BadSignature",
      );
    });

    it("reverts an intent past its deadline", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "read_calendar", deadline: await time.latest() })).to.be.revertedWithCustomError(
        ctx.guard,
        "IntentExpired",
      );
    });

    it("reverts a skipped/out-of-order nonce", async () => {
      const ctx = await setup();
      await expect(send(ctx, { action: "read_calendar", nonce: 5n })).to.be.revertedWithCustomError(
        ctx.guard,
        "BadNonce",
      );
    });

    it("rejects a signature made for a different contract deployment", async () => {
      const ctx = await setup();
      const other = { ...ctx.domain, verifyingContract: ethers.Wallet.createRandom().address };
      const intent = {
        grantId: ctx.grantId,
        actionId: actionId("read_calendar"),
        payee: ethers.ZeroAddress,
        amount: 0n,
        paramsHash: ethers.ZeroHash,
        nonce: 0n,
        deadline: (await time.latest()) + 3600,
      };
      const sig = await ctx.agent.signTypedData(other, INTENT_TYPES, intent);
      await expect(
        ctx.guard.connect(ctx.relayer).execute(intent, sig, [proofFor(ctx, "read_calendar")]),
      ).to.be.revertedWithCustomError(ctx.guard, "BadSignature");
    });
  });

  describe("revocation", () => {
    it("refunds escrow, blocks the agent, and is owner-only", async () => {
      const ctx = await setup();
      await expect(ctx.guard.connect(ctx.stranger).revoke(ctx.grantId)).to.be.revertedWithCustomError(
        ctx.guard,
        "NotGrantOwner",
      );
      await expect(ctx.guard.connect(ctx.owner).revoke(ctx.grantId)).to.changeEtherBalance(ctx.owner, eth("1"));

      await expect(send(ctx, { action: "read_calendar" }))
        .to.emit(ctx.guard, "Denied")
        .withArgs(ctx.grantId, 0n, actionId("read_calendar"), Reason.Revoked, 0);

      await expect(ctx.guard.connect(ctx.owner).revoke(ctx.grantId)).to.be.revertedWithCustomError(
        ctx.guard,
        "WrongStatus",
      );
    });
  });

  describe("audit hash-chain", () => {
    it("can be recomputed from events and matches the on-chain head", async () => {
      const ctx = await setup();
      await send(ctx, { action: "read_calendar", paramsHash: ethers.id("cal-1") });
      await send(ctx, { action: "transfer_funds", amount: eth("0.05"), payee: ctx.attacker.address });
      await send(ctx, { action: "pay_invoice", amount: eth("0.02"), payee: ctx.payee.address });

      const events = await ctx.guard.queryFilter(ctx.guard.filters.AuditAppended());
      expect(events.length).to.equal(3);

      const coder = ethers.AbiCoder.defaultAbiCoder();
      let head = ethers.ZeroHash;
      for (const ev of events) {
        const a = ev.args;
        head = ethers.keccak256(
          coder.encode(
            ["bytes32", "uint256", "bytes32", "uint256", "bytes32", "uint8", "uint256"],
            [head, a.grantId, a.actionId, a.amount, a.paramsHash, a.code, ev.blockNumber],
          ),
        );
        expect(head).to.equal(a.head);
      }
      expect(head).to.equal(await ctx.guard.auditHead());
      expect(await ctx.guard.auditCount()).to.equal(3n);
    });

    it("breaks if any entry is edited", async () => {
      const ctx = await setup();
      await send(ctx, { action: "read_calendar" });
      await send(ctx, { action: "send_email" });
      const events = await ctx.guard.queryFilter(ctx.guard.filters.AuditAppended());

      const coder = ethers.AbiCoder.defaultAbiCoder();
      let head = ethers.ZeroHash;
      for (let k = 0; k < events.length; k++) {
        const a = events[k].args;
        const amount = k === 0 ? 999n : a.amount; // tamper with entry 0
        head = ethers.keccak256(
          coder.encode(
            ["bytes32", "uint256", "bytes32", "uint256", "bytes32", "uint8", "uint256"],
            [head, a.grantId, a.actionId, amount, a.paramsHash, a.code, events[k].blockNumber],
          ),
        );
      }
      expect(head).to.not.equal(await ctx.guard.auditHead());
    });
  });
});
