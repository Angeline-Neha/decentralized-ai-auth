import * as fs from "node:fs";
import * as path from "node:path";

export interface DeploymentInfo {
  address: string;
  chainId: number;
  deployer: string;
  abi: readonly unknown[];
  /** Optional creation bytecode (written by deploy.ts) so /dev/reset can redeploy without Hardhat artifacts. */
  bytecode?: string;
}

/** Load contracts/deployments/<network>.json written by Hardhat deploy script. */
export function loadDeployment(filePath: string): DeploymentInfo {
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const parsed = JSON.parse(raw) as DeploymentInfo;
  if (!parsed.address || !parsed.abi) {
    throw new Error(`Invalid deployment file: ${filePath}`);
  }
  return parsed;
}
