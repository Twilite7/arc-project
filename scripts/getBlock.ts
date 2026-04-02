import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const block = await ethers.provider.getBlockNumber();
  console.log("Current block:", block);
  await connection.close();
}

main().catch(console.error);
