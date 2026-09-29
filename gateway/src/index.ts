import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { closeDb } from "./db/index.js";
import { startIndexer, stopIndexer } from "./indexer/index.js";
import { grantRoutes } from "./routes/grants.js";
import { intentRoutes } from "./routes/intents.js";
import { delegationRoutes } from "./routes/delegations.js";
import { eventRoutes } from "./routes/events.js";
import { auditRoutes } from "./routes/audit.js";
import { streamRoutes } from "./routes/stream.js";
import { devRoutes } from "./routes/dev.js";
import { configRoutes } from "./routes/config.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(grantRoutes);
await app.register(intentRoutes);
await app.register(delegationRoutes);
await app.register(eventRoutes);
await app.register(auditRoutes);
await app.register(streamRoutes);
await app.register(devRoutes);
await app.register(configRoutes);

app.get("/", async () => ({
  name: "AgentGuard Gateway",
  version: "0.1.0",
  contract: config.deployment.address,
  endpoints: [
    "GET /grants",
    "GET /grants/:id",
    "POST /grants/:id/manifest",
    "GET /grants/:id/proof?action=",
    "POST /intents",
    "POST /delegations",
    "GET /events",
    "GET /audit/verify",
    "GET /stream",
    "POST /dev/advance-time",
    "POST /dev/tamper-audit",
  ],
}));

await startIndexer();

const shutdown = async () => {
  stopIndexer();
  await app.close();
  closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Gateway listening on http://127.0.0.1:${config.port}`);
  app.log.info(`AgentGuard @ ${config.deployment.address} (chain ${config.deployment.chainId})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
