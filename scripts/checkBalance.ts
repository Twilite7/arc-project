import { network } from "hardhat";

async function main() {
  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Native USDC balance:", ethers.formatUnits(balance, 18), "USDC");

  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
