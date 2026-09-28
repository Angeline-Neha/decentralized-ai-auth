/**
 * npm start — expects Ganache by default (or Hardhat node if START_HARDHAT_NODE=1).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = path.join(root, "contracts");
const agentDir = path.join(root, "agent");
const isWin = process.platform === "win32";

const children = [];

function loadRootEnv() {
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadRootEnv();

const startHardhat = process.env.START_HARDHAT_NODE === "1";
const rpcUrl = process.env.RPC_URL || (startHardhat ? "http://127.0.0.1:8545" : "http://127.0.0.1:7545");
const deployNetwork = process.env.DEPLOY_NETWORK || (startHardhat ? "localhost" : "ganache");

process.env.RPC_URL = rpcUrl;
process.env.GANACHE_RPC_URL = rpcUrl;
if (process.env.CHAIN_ID) process.env.GANACHE_CHAIN_ID = process.env.CHAIN_ID;

function log(msg) {
  console.log(`\n[agentguard] ${msg}\n`);
}

function runSync(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, shell: isWin, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function spawnTagged(tag, cmd, args, cwd = root) {
  const p = spawn(cmd, args, {
    cwd,
    shell: isWin,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(p);
  const prefix = (s) => process.stdout.write(s.toString().replace(/^/gm, `[${tag}] `));
  p.stdout?.on("data", prefix);
  p.stderr?.on("data", (d) => process.stderr.write(d.toString().replace(/^/gm, `[${tag}] `)));
  return p;
}

async function waitRpc(url, timeoutMs = 120_000) {
  const body = JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (r.ok) {
        const j = await r.json();
        if (j.result) return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(
    `RPC not ready at ${url}. Start Ganache first (or set RPC_URL in .env). See docs/GANACHE.md`,
  );
}

async function waitHttp(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`HTTP not ready: ${url}`);
}

async function postManifest() {
  const r = await fetch("http://127.0.0.1:3001/grants/1/manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actions: ["read_calendar", "send_email", "pay_invoice"] }),
  });
  if (!r.ok) throw new Error(`Manifest upload failed: ${await r.text()}`);
  log("Manifest uploaded for grant #1");
}

function agentCommand() {
  const venvPy = path.join(agentDir, ".venv", isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
  if (fs.existsSync(venvPy)) {
    return { cmd: venvPy, args: ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], cwd: agentDir };
  }
  return { cmd: "python", args: ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], cwd: agentDir };
}

function shutdown() {
  log("Shutting down…");
  for (const p of children) {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(p.pid), "/f", "/t"], { stdio: "ignore", shell: true });
      else p.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  log("Building shared package…");
  runSync("npm", ["run", "build:shared"]);

  if (!fs.existsSync(path.join(root, "gateway", ".env"))) {
    log("Copy gateway/.env.example → gateway/.env — then set RELAYER_PRIVATE_KEY from Ganache account #2");
    fs.copyFileSync(path.join(root, "gateway", ".env.example"), path.join(root, "gateway", ".env"));
  }

  if (startHardhat) {
    log("Starting Hardhat node on :8545…");
    spawnTagged("chain", "npx", ["hardhat", "node"], contractsDir);
  } else {
    log(`Using external chain at ${rpcUrl} (start Ganache if not running)`);
  }

  await waitRpc(rpcUrl);

  log(`Deploying to network "${deployNetwork}"…`);
  runSync("npm", ["run", `deploy:${deployNetwork === "localhost" ? "local" : "ganache"}`, "-w", "contracts"]);

  log("Seeding demo grant #1…");
  runSync("npm", ["run", `seed:${deployNetwork === "localhost" ? "local" : "ganache"}`, "-w", "contracts"]);

  log("Starting gateway on :3001…");
  spawnTagged("gateway", "npm", ["run", "dev", "-w", "gateway"]);
  await waitHttp("http://127.0.0.1:3001/");

  await postManifest();

  const ag = agentCommand();
  log("Starting Python agent on :8000…");
  spawnTagged("agent", ag.cmd, ag.args, ag.cwd);

  log("Starting web UI on :5173…");
  spawnTagged("web", "npm", ["run", "dev", "-w", "web"]);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  AgentGuard is running                                   ║
║  UI:      http://127.0.0.1:5173                          ║
║  Gateway: http://127.0.0.1:3001                          ║
║  Agent:   http://127.0.0.1:8000                          ║
║  RPC:     ${rpcUrl.padEnd(43)}║
║  Keys:    Ganache acct #1 → agent/.env  #2 → gateway/.env ║
║  Press Ctrl+C to stop (Ganache keeps running)            ║
╚══════════════════════════════════════════════════════════╝
`);
}

main().catch((e) => {
  console.error(e);
  shutdown();
});
