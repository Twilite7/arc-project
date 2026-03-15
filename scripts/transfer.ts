import { network } from "hardhat";

async function main() {
  const CONTRACT_ADDRESS = "0x9Cab223CC238602dbd9d7c438E0aa9Ac89382090";
  const RECIPIENT        = "0x88CF4649FA51F1e62Ad815F6F14291Ad52096AdE";
  const AMOUNT           = "100"; // human-readable CUSD to send

  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Sending from:", deployer.address);
  console.log("Sending to:  ", RECIPIENT);
  console.log("Amount:      ", AMOUNT, "CUSD");
  console.log("---");

  const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address, uint256) returns (bool)",
  ];

  const token = await ethers.getContractAt(abi, CONTRACT_ADDRESS, deployer);

  // Check balances before
  const beforeSender    = await token.balanceOf(deployer.address);
  const beforeRecipient = await token.balanceOf(RECIPIENT);
  console.log("Before — sender balance:   ", ethers.formatUnits(beforeSender, 18), "CUSD");
  console.log("Before — recipient balance:", ethers.formatUnits(beforeRecipient, 18), "CUSD");
  console.log("---");

  // Convert human amount to raw units
  const rawAmount = ethers.parseUnits(AMOUNT, 18);

  // Send the transaction
  console.log("Sending transaction...");
  const tx = await token.transfer(RECIPIENT, rawAmount);
  console.log("Transaction hash:", tx.hash);

  // Wait for confirmation
  console.log("Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("---");

  // Check balances after
  const afterSender    = await token.balanceOf(deployer.address);
  const afterRecipient = await token.balanceOf(RECIPIENT);
  console.log("After — sender balance:   ", ethers.formatUnits(afterSender, 18), "CUSD");
  console.log("After — recipient balance:", ethers.formatUnits(afterRecipient, 18), "CUSD");

  await connection.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
