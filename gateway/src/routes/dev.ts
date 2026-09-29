import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet, parseEther, type Signer } from "ethers";
import { config } from "../config.js";
import { restoreAuditFromChain, tamperAuditRow } from "../audit/verify.js";
import { getCalendar, getInbox } from "../providers/mock.js";
import { getProvider, updateDeploymentAddress } from "../contract/client.js";
import { saveManifest } from "../proof/service.js";
import { adoptFreshDeployment, isContractLive, startIndexer, stopIndexer, syncNow } from "../indexer/index.js";
import { buildActionTree } from "@agentguard/shared/merkle";
import { sse } from "../sse/broadcaster.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWNER_PRIVATE_KEY = "0x79ccfcb428668eb125c1ca954de251a9d4f985bd3e9abfd88bea9343f4451de1";
const AGENT_ADDRESS = "0x11a32cCeA9ABFa3e67f3ab5842CbD97dd74fdB88";

export async function devRoutes(app: FastifyInstance) {
  if (!config.devMode) {
    app.addHook("onRequest", async () => {
      throw app.httpErrors.notFound("Dev routes disabled");
    });
  }

  /** Advance Hardhat chain time (requires Hardhat node with evm_increaseTime). */
  app.post<{ Body: { seconds: number } }>("/dev/advance-time", async (req) => {
    const seconds = req.body?.seconds ?? 3600;
    const provider = new JsonRpcProvider(config.rpcUrl);
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
    const block = await provider.getBlock("latest");
    return { advancedSeconds: seconds, timestamp: block?.timestamp };
  });

  /** Corrupt one indexed audit row to demo hash-chain verification failure. */
  app.post<{ Body: { index: number; field?: "amount" | "code" | "action_id" | "action_name" | "head"; value?: string } }>(
    "/dev/tamper-audit",
    async (req) => {
      const index = req.body?.index;
      if (index === undefined) return app.httpErrors.badRequest("index required");
      tamperAuditRow(index, req.body.field ?? "amount", req.body.value ?? "999999999999999999");
      return { tampered: index, field: req.body.field ?? "amount" };
    },
  );

  /** Restore SQLite audit entries from on-chain event logs */
  app.post("/dev/restore-audit", async () => {
    await restoreAuditFromChain();
    return { status: "ok", message: "Audit logs restored from on-chain ground truth" };
  });

  app.get("/dev/inbox", async () => ({ inbox: getInbox() }));
  app.get("/dev/calendar", async () => ({ calendar: getCalendar() }));

  app.get("/dev/health", async () => ({
    rpcUrl: config.rpcUrl,
    contract: config.deployment.address,
    chainId: config.deployment.chainId,
    devMode: config.devMode,
    contractLive: isContractLive(),
  }));

  /**
   * Reset demo state: deploy a brand-new AgentGuard, create Grant #1, wipe the local index, and tell every
   * connected UI to reload. Fails loudly (HTTP 500) instead of pretending it worked.
   */
  let resetting: Promise<unknown> | null = null;
  app.post("/dev/reset", async (_req, reply) => {
    if (resetting) return reply.code(409).send({ error: "Reset already in progress" });
    resetting = doReset();
    try {
      return await resetting;
    } catch (e: any) {
      app.log.error({ err: e }, "Reset failed");
      return reply.code(500).send({ status: "error", error: e?.shortMessage ?? e?.message ?? String(e) });
    } finally {
      resetting = null;
      startIndexer().catch((e) => app.log.error({ err: e }, "indexer restart failed"));
    }
  });
}

function findArtifact(): { abi: any; bytecode: string } | null {
  const rels = ["contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json"];
  const bases = [path.resolve(__dirname, "../../.."), path.resolve(__dirname, "../../../.."), process.cwd(), path.resolve(process.cwd(), "..")];
  for (const b of bases) {
    for (const r of rels) {
      const f = path.join(b, r);
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, "utf8"));
        if (j.bytecode && j.bytecode !== "0x") return { abi: j.abi, bytecode: j.bytecode };
      }
    }
  }
  const dep = config.deployment;
  if (dep.bytecode) return { abi: dep.abi as any, bytecode: dep.bytecode };
  return null;
}

function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

async function doReset() {
  const artifact = findArtifact();
  if (!artifact) {
    throw new Error("AgentGuard artifact/bytecode not found. Run `npm run deploy` (or `npm run compile -w contracts`) once, then retry.");
  }
  stopIndexer();
  const provider = getProvider();

  // Prefer the node's unlocked accounts (Ganache/Hardhat): the node assigns nonces itself, so there is no
  // client-side nonce cache to go stale. Falls back to the well-known dev key if the node exposes none.
  const accounts: string[] = await provider.send("eth_accounts", []);
  let owner: Signer;
  let agentAddress: string;
  if (accounts.length >= 2) {
    owner = await provider.getSigner(accounts[0]);
    agentAddress = accounts[1];
  } else {
    owner = new NonceManager(new Wallet(process.env.OWNER_PRIVATE_KEY ?? OWNER_PRIVATE_KEY, provider));
    agentAddress = process.env.AGENT_ADDRESS ?? AGENT_ADDRESS;
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
  const guardContract = await factory.deploy();
  await guardContract.waitForDeployment();
  const newAddress = await guardContract.getAddress();

  const actions = ["read_calendar", "send_email", "pay_invoice"];
  const tree = buildActionTree(actions);
  const latest = await provider.getBlock("latest");
  const now = Math.max(Math.floor(Date.now() / 1000), latest?.timestamp ?? 0);
  const tx = await (guardContract as any).createGrant(
    {
      agent: agentAddress,
      actionsRoot: tree.root,
      perCallCap: parseEther("0.1"),
      totalBudget: parseEther("0.5"),
      maxCallsPerWindow: 5,
      windowSeconds: 3600,
      expiry: now + 30 * 86400,
      approvalThreshold: parseEther("0.05"),
      maxStrikes: 3,
    },
    { value: parseEther("1") },
  );
  await tx.wait();

  // Persist the new address in the deployment file(s) the gateway / scripts / verify_audit read.
  const dir = path.dirname(config.deploymentPath);
  const files = new Set([config.deploymentPath, path.join(dir, "ganache.json"), path.join(dir, "localhost.json")]);
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      data.address = newAddress;
      writeJsonAtomic(f, data);
    } catch (e) {
      console.error(`Could not update ${f}:`, e);
    }
  }
  updateDeploymentAddress(newAddress);

  await adoptFreshDeployment(); // wipes every table for the old contract
  saveManifest(1, actions, tree.root);
  await syncNow(); // grants + (empty) audit for the new contract

  sse.publish({ type: "reset", data: { address: newAddress } });
  sse.publish({ type: "grant", data: { grantId: 1, event: "Reset", address: newAddress } });
  return { status: "ok", address: newAddress, message: "Fresh contract deployed; everything wiped; Grant #1 seeded" };
}
