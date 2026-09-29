import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { config } from "../config.js";
import { tamperAuditRow } from "../audit/verify.js";
import { getCalendar, getInbox } from "../providers/mock.js";
import { getDb } from "../db/index.js";
import { getGuardReadOnly, getProvider, updateDeploymentAddress } from "../contract/client.js";
import { saveManifest } from "../proof/service.js";
import { syncGrantsFromChain } from "../indexer/index.js";
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
  app.post<{ Body: { index: number; field?: "amount" | "code"; value?: string } }>(
    "/dev/tamper-audit",
    async (req) => {
      const index = req.body?.index;
      if (index === undefined) return app.httpErrors.badRequest("index required");
      tamperAuditRow(index, req.body.field ?? "amount", req.body.value ?? "999999999999999999");
      return { tampered: index, field: req.body.field ?? "amount" };
    },
  );

  app.get("/dev/inbox", async () => ({ inbox: getInbox() }));
  app.get("/dev/calendar", async () => ({ calendar: getCalendar() }));

  app.get("/dev/health", async () => ({
    rpcUrl: config.rpcUrl,
    contract: config.deployment.address,
    chainId: config.deployment.chainId,
    devMode: config.devMode,
  }));

  /** Reset demo state: deploys a fresh contract on-chain and seeds Grant #1 cleanly */
  app.post("/dev/reset", async () => {
    try {
      const provider = getProvider();
      const owner = new Wallet(OWNER_PRIVATE_KEY, provider);

      const candidates = [
        path.resolve(__dirname, "../../contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json"),
        path.resolve(__dirname, "../../../contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json"),
        path.resolve(process.cwd(), "contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json"),
        path.resolve(process.cwd(), "../contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json"),
      ];
      const artifactPath = candidates.find((p) => fs.existsSync(p));
      let artifact: { abi: any; bytecode: string } | null = null;
      if (artifactPath && fs.existsSync(artifactPath)) {
        artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      }

      if (artifact && artifact.bytecode) {
        const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
        const guardContract = await factory.deploy();
        await guardContract.waitForDeployment();
        const newAddress = await guardContract.getAddress();

        const actions = ["read_calendar", "send_email", "pay_invoice"];
        const tree = buildActionTree(actions);
        const tx = await (guardContract as any).createGrant(
          {
            agent: AGENT_ADDRESS,
            actionsRoot: tree.root,
            perCallCap: parseEther("0.1"),
            totalBudget: parseEther("0.5"),
            maxCallsPerWindow: 5,
            windowSeconds: 3600,
            expiry: 2000000000,
            approvalThreshold: parseEther("0.05"),
            maxStrikes: 3,
          },
          { value: parseEther("1") },
        );
        await tx.wait();

        // Update JSON deployment files
        const depFiles = [
          path.resolve(__dirname, "../../contracts/deployments/ganache.json"),
          path.resolve(__dirname, "../../../contracts/deployments/ganache.json"),
          path.resolve(process.cwd(), "contracts/deployments/ganache.json"),
          path.resolve(process.cwd(), "../contracts/deployments/ganache.json"),
          path.resolve(__dirname, "../../contracts/deployments/localhost.json"),
          path.resolve(__dirname, "../../../contracts/deployments/localhost.json"),
          path.resolve(process.cwd(), "contracts/deployments/localhost.json"),
          path.resolve(process.cwd(), "../contracts/deployments/localhost.json"),
        ];
        for (const f of depFiles) {
          if (fs.existsSync(f)) {
            try {
              const data = JSON.parse(fs.readFileSync(f, "utf8"));
              data.address = newAddress;
              fs.writeFileSync(f, JSON.stringify(data, null, 2));
            } catch {}
          }
        }

        updateDeploymentAddress(newAddress);

        const db = getDb();
        db.prepare("DELETE FROM audit_events").run();
        db.prepare("DELETE FROM provider_runs").run();
        db.prepare("DELETE FROM pending_intents").run();
        db.prepare("DELETE FROM grants").run();
        db.prepare("DELETE FROM grant_manifests").run();

        saveManifest(1, actions, tree.root);
        await syncGrantsFromChain();
        sse.publish({ type: "grant", data: { grantId: 1, event: "Reset" } });

        return { status: "ok", address: newAddress, message: "Fresh contract deployed and Grant #1 seeded" };
      }
    } catch (e: any) {
      console.error("Deploy/reset error:", e);
    }

    // Fallback: clear DB
    const db = getDb();
    db.prepare("DELETE FROM audit_events").run();
    db.prepare("DELETE FROM provider_runs").run();
    db.prepare("DELETE FROM pending_intents").run();
    db.prepare("DELETE FROM grants WHERE id > 1").run();
    db.prepare("DELETE FROM grant_manifests WHERE grant_id > 1").run();
    await syncGrantsFromChain();
    return { status: "ok", message: "Demo state reset successfully" };
  });
}
