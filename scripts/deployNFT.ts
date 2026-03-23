import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Factory = await ethers.getContractFactory("ClaudeNFT", deployer);
  const contract = await Factory.deploy("ipfs://bafybeiemc2iyvwkhe4agqmuo7ihsrnwohxuykwmcowgvu7ludttt5sx7ly/");
  await contract.waitForDeployment();

  console.log("ClaudeNFT deployed to:", await contract.getAddress());
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
