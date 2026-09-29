import { ContractFactory, JsonRpcProvider, Wallet, parseEther } from "ethers";
import fs from "fs";
import path from "path";
import { buildActionTree } from "@agentguard/shared/merkle";

async function testReset() {
  const p = new JsonRpcProvider("http://127.0.0.1:7545");
  const owner = new Wallet("0x79ccfcb428668eb125c1ca954de251a9d4f985bd3e9abfd88bea9343f4451de1", p);
  const art = JSON.parse(fs.readFileSync("contracts/artifacts/contracts/AgentGuard.sol/AgentGuard.json", "utf8"));

  const start = Date.now();
  const factory = new ContractFactory(art.abi, art.bytecode, owner);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("Deployed new contract to:", address, `(${Date.now() - start}ms)`);

  const actions = ["read_calendar", "send_email", "pay_invoice"];
  const tree = buildActionTree(actions);
  const tx = await contract.createGrant(
    {
      agent: "0x11a32cCeA9ABFa3e67f3ab5842CbD97dd74fdB88",
      actionsRoot: tree.root,
      perCallCap: parseEther("0.1"),
      totalBudget: parseEther("0.5"),
      maxCallsPerWindow: 5,
      windowSeconds: 3600,
      expiry: 2000000000,
      approvalThreshold: parseEther("0.05"),
      maxStrikes: 3,
    },
    { value: parseEther("1") }
  );
  await tx.wait();
  console.log("Created Grant #1! Total time:", Date.now() - start, "ms");
}

testReset().catch(console.error);
