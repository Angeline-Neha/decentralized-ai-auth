import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment } from "@agentguard/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
}

const gatewayRoot = path.join(__dirname, "..");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8545"),
  relayerPrivateKey: env("RELAYER_PRIVATE_KEY"),
  dbPath: path.resolve(gatewayRoot, process.env.DB_PATH ?? "./data/gateway.db"),
  devMode: (process.env.DEV_MODE ?? "true").toLowerCase() === "true",
  mock: {
    emailApiKey: process.env.MOCK_EMAIL_API_KEY ?? "demo-email-key",
    calendarApiKey: process.env.MOCK_CALENDAR_API_KEY ?? "demo-calendar-key",
  },
  deployment: loadDeployment(
    path.resolve(gatewayRoot, process.env.DEPLOYMENT_PATH ?? "../contracts/deployments/localhost.json"),
  ),
};

export function ensureDataDir() {
  const dir = path.dirname(config.dbPath);
  fs.mkdirSync(dir, { recursive: true });
}
