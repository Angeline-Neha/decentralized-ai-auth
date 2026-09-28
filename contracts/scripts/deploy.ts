import { ethers, artifacts, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const guard = await (await ethers.getContractFactory("AgentGuard")).deploy();
  await guard.waitForDeployment();

  const address = await guard.getAddress();
  const { chainId } = await ethers.provider.getNetwork();
  const artifact = await artifacts.readArtifact("AgentGuard");

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ address, chainId: Number(chainId), deployer: deployer.address, abi: artifact.abi }, null, 2),
  );

  console.log(`AgentGuard deployed to ${address} (chainId ${chainId})`);
  console.log(`Deployment + ABI written to ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
