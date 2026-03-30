import { network } from "hardhat";

const CONTRACT_ADDRESS = "0x430F60E18B4aE0BF8282133aC449C472a81af61B";
async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Connected wallet:", deployer.address);

  const contract = await ethers.getContractAt("XylemNFT", CONTRACT_ADDRESS, deployer);

  // Whitelist deployer
  console.log("\nAdding to whitelist...");
  const whitelistTx = await contract.addToWhitelist(deployer.address);
  await whitelistTx.wait();
  console.log("Whitelisted:", deployer.address);

  // Confirm whitelist status
  const isWhitelisted = await contract.whitelist(deployer.address);
  console.log("Is whitelisted:", isWhitelisted);

  // Mint with 0.01 ETH
  console.log("\nMinting NFT...");
  const mintTx = await contract.mint({ value: ethers.parseEther("0.0001") });
  await mintTx.wait();
  console.log("Mint tx:", mintTx.hash);

  // Check results
  const supplyAfter = await contract.totalSupply();
  console.log("Total supply:", supplyAfter.toString());

  const owner = await contract.ownerOf(1);
  console.log("Owner of token #1:", owner);

  // Check contract ETH balance
  const contractBalance = await ethers.provider.getBalance(CONTRACT_ADDRESS);
  console.log("Contract balance:", ethers.formatEther(contractBalance), "ETH");

  // Withdraw ETH to owner
  console.log("\nWithdrawing ETH...");
  const withdrawTx = await contract.withdraw();
  await withdrawTx.wait();
  console.log("Withdraw tx:", withdrawTx.hash);

  const balanceAfter = await ethers.provider.getBalance(CONTRACT_ADDRESS);
  console.log("Contract balance after withdraw:", ethers.formatEther(balanceAfter), "ETH");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
