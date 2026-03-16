import { network } from "hardhat";

const CONTRACT_ADDRESS = "0x8CceC8B8c56F1b970E7A0540d9A20198D93D0834";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD"; // burn address as test recipient

async function main() {
  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  console.log("Connected wallet:", deployer.address);

  const contract = await ethers.getContractAt("ClaudeUSD", CONTRACT_ADDRESS, deployer);

  // Check total supply
  const supply = await contract.totalSupply();
  console.log("Total Supply:", ethers.formatUnits(supply, 6), "CUSD");

  // Check deployer balance before
  const balanceBefore = await contract.balanceOf(deployer.address);
  console.log("Balance Before:", ethers.formatUnits(balanceBefore, 6), "CUSD");

  // Transfer 10 CUSD to burn address
  const amount = ethers.parseUnits("10", 6);
  console.log("\nTransferring 10 CUSD to burn address...");
  const tx = await contract.transfer(RECIPIENT, amount);
  await tx.wait();
  console.log("Transaction hash:", tx.hash);

  // Check balance after
  const balanceAfter = await contract.balanceOf(deployer.address);
  console.log("Balance After:", ethers.formatUnits(balanceAfter, 6), "CUSD");

  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
