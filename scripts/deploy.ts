import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Factory = await ethers.getContractFactory("XylemUSD", deployer);
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  console.log("XylemUSD deployed to:", await contract.getAddress());
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
