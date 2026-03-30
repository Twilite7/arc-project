import { network } from "hardhat";

const CONTRACT_ADDRESS = "0x0030Bb033e01bF1749F2Aeb8d249578c405EC3a4";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD"; // burn address as test recipient

async function main() {
  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  console.log("Connected wallet:", deployer.address);

  const contract = await ethers.getContractAt("XylemUSD", CONTRACT_ADDRESS, deployer);

  // Check total supply
  const supply = await contract.totalSupply();
  console.log("Total Supply:", ethers.formatUnits(supply, 6), "XUSD");

  // Check deployer balance before
  const balanceBefore = await contract.balanceOf(deployer.address);
  console.log("Balance Before:", ethers.formatUnits(balanceBefore, 6), "XUSD");

// Mint 500 XUSD to deployer
  console.log("\nMinting 500 XUSD...");
  const mintTx = await contract.mint(deployer.address, ethers.parseUnits("500", 6));
  await mintTx.wait();
  console.log("Mint tx:", mintTx.hash);

  const afterMint = await contract.balanceOf(deployer.address);
  console.log("Balance after mint:", ethers.formatUnits(afterMint, 6), "XUSD");

  // Burn 100 XUSD
  console.log("\nBurning 100 XUSD...");
  const burnTx = await contract.burn(ethers.parseUnits("100", 6));
  await burnTx.wait();
  console.log("Burn tx:", burnTx.hash);

  const afterBurn = await contract.balanceOf(deployer.address);
  console.log("Balance after burn:", ethers.formatUnits(afterBurn, 6), "XUSD");

  const finalSupply = await contract.totalSupply();
  console.log("Final total supply:", ethers.formatUnits(finalSupply, 6), "XUSD");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
