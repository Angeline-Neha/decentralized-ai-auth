import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getDb } from "../db/index.js";

export async function configRoutes(app: FastifyInstance) {
  app.get("/config", async () => ({
    address: config.deployment.address,
    chainId: config.deployment.chainId,
    rpcUrl: config.rpcUrl,
    abi: config.deployment.abi,
  }));

  app.get("/pending", async () => {
    const rows = getDb()
      .prepare(
        `SELECT p.*, g.agent, g.owner FROM pending_intents p
         LEFT JOIN grants g ON g.id = p.grant_id
         WHERE p.status = 1 ORDER BY p.pending_id ASC`,
      )
      .all();
    return { pending: rows };
  });
}
