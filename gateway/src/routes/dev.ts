import type { FastifyInstance } from "fastify";
import { JsonRpcProvider } from "ethers";
import { config } from "../config.js";
import { tamperAuditRow } from "../audit/verify.js";
import { getCalendar, getInbox } from "../providers/mock.js";

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
}
