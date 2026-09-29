import { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes, ZeroHash, ZeroAddress } from "ethers";
import fs from "fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

async function main() {
  const dep = JSON.parse(fs.readFileSync("contracts/deployments/ganache.json", "utf8"));
  const p = new JsonRpcProvider("http://127.0.0.1:7545");
  const agentWallet = new Wallet("0x4b4cf95439191dada441c9f2dbc2759b60560ba138dadd1a5b576ec4c4335634", p);
  const relayerWallet = new Wallet("0xb1a0f2c72f8cfb1413c2546ce758cf99e7361e3dd1c3190b9efb574cee105309", p);
  const guard = new Contract(dep.address, dep.abi, relayerWallet);
  
  const domain = {
    name: "AgentGuard",
    version: "1",
    chainId: 1337n,
    verifyingContract: dep.address,
  };
  const types = {
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
  const actionName = "read_calendar";
  const actionId = keccak256(toUtf8Bytes(actionName));
  const latestBlock = await p.getBlock("latest");
  const blockTime = latestBlock.timestamp;
  const intent = {
    grantId: 1n,
    actionId: actionId,
    payee: ZeroAddress,
    amount: 0n,
    paramsHash: keccak256(toUtf8Bytes(JSON.stringify({ view: "today" }))),
    nonce: 0n,
    deadline: BigInt(blockTime + 86400),
  };
  const sig = await agentWallet.signTypedData(domain, types, intent);
  console.log("Block time:", blockTime);
  console.log("Agent:", agentWallet.address);
  console.log("Signature:", sig);

  const actions = ["read_calendar", "send_email", "pay_invoice"];
  const tree = StandardMerkleTree.of(actions.map(a => [keccak256(toUtf8Bytes(a))]), ["bytes32"]);
  const proof = tree.getProof([actionId]);
  console.log("Tree root:", tree.root);

  try {
    const res = await guard.execute.staticCall(intent, sig, [proof]);
    console.log("StaticCall success! Result (Reason):", res);
  } catch(e) {
    console.log("StaticCall error:", e);
  }

  try {
    const tx = await guard.execute(intent, sig, [proof], { gasLimit: 500000 });
    const rc = await tx.wait();
    console.log("Tx mined! Hash:", rc.hash, "Logs:", rc.logs.length);
  } catch(e) {
    console.log("Tx error:", e);
  }
}

main().catch(console.error);
