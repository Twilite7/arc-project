import { network } from "hardhat";

async function main() {
  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Factory = await ethers.getContractFactory("SimpleStorage", deployer);
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  console.log("Contract deployed to:", await contract.getAddress());
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

