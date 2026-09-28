import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

/**
 * Creates grant #1 for local demos.
 * Agent = Hardhat account #1 (matches agent/.env).
 * Owner = account #0 (deployer).
 */
async function main() {
  const depFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(depFile)) {
    throw new Error(`Run deploy first: npm run deploy (missing ${depFile})`);
  }
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const [owner, agent] = await ethers.getSigners();

  const actions = ["read_calendar", "send_email", "pay_invoice"];
  const tree = StandardMerkleTree.of(
    actions.map((n) => [ethers.id(n)]),
    ["bytes32"],
  );
  const now = Math.floor(Date.now() / 1000);

  const guard = await ethers.getContractAt("AgentGuard", dep.address, owner);
  const tx = await guard.createGrant(
    {
      agent: agent.address,
      actionsRoot: tree.root,
      perCallCap: ethers.parseEther("0.1"),
      totalBudget: ethers.parseEther("0.5"),
      maxCallsPerWindow: 5,
      windowSeconds: 3600,
      expiry: now + 86400,
      approvalThreshold: ethers.parseEther("0.05"),
      maxStrikes: 3,
    },
    { value: ethers.parseEther("1") },
  );
  await tx.wait();

  console.log("Grant created: id=1");
  console.log("  owner:", owner.address);
  console.log("  agent:", agent.address, "(Ganache/Hardhat account #1 — set AGENT_PRIVATE_KEY in agent/.env)");
  console.log("  relayer: use Ganache account #2 private key in gateway/.env RELAYER_PRIVATE_KEY");
  console.log("  actionsRoot:", tree.root);
  console.log("  actions:", actions.join(", "));
  console.log("\nAfter gateway is up, upload manifest:");
  console.log(
    `  curl -X POST http://127.0.0.1:3001/grants/1/manifest -H "Content-Type: application/json" -d "{\\"actions\\":[\\"read_calendar\\",\\"send_email\\",\\"pay_invoice\\"]}"`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
