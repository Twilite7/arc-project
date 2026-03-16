import { network } from "hardhat";

async function main() {
  const CONTRACT_ADDRESS = "0x9Cab223CC238602dbd9d7c438E0aa9Ac89382090";
  const SPENDER          = "0x88CF4649FA51F1e62Ad815F6F14291Ad52096AdE";
  const AMOUNT           = "50"; // I want to approve and transfer this many CUSD

  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Owner (you):  ", deployer.address);
  console.log("Spender:      ", SPENDER);
  console.log("Amount:       ", AMOUNT, "CUSD");
  console.log("---");

  const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transferFrom(address, address, uint256) returns (bool)",
  ];

  // I attach to my deployed ClaudeUSD contract
  const token = await ethers.getContractAt(abi, CONTRACT_ADDRESS, deployer);
  const rawAmount = ethers.parseUnits(AMOUNT, 18);

  // I check the state before doing anything
  const balanceBefore   = await token.balanceOf(deployer.address);
  const allowanceBefore = await token.allowance(deployer.address, SPENDER);
  console.log("Balance before:   ", ethers.formatUnits(balanceBefore, 18), "CUSD");
  console.log("Allowance before: ", ethers.formatUnits(allowanceBefore, 18), "CUSD");
  console.log("---");

  // I call approve() to grant the spender permission to move my tokens
  console.log("Step 1 — calling approve()...");
  const approveTx = await token.approve(SPENDER, rawAmount);
  console.log("Approve tx hash: ", approveTx.hash);
  await approveTx.wait();
  console.log("Approved.");

  // I verify the allowance was set correctly before moving on
  const allowanceAfterApprove = await token.allowance(deployer.address, SPENDER);
  console.log("Allowance after approve:", ethers.formatUnits(allowanceAfterApprove, 18), "CUSD");
  console.log("---");

  // I call transferFrom() to simulate the spender pulling tokens on my behalf
  // In a real DEX this call would come from the DEX contract, not me
  console.log("Step 2 — calling transferFrom()...");
  const transferTx = await token.transferFrom(deployer.address, SPENDER, rawAmount);
  console.log("TransferFrom tx hash:", transferTx.hash);
  const receipt = await transferTx.wait();
  console.log("Confirmed in block:  ", receipt.blockNumber);
  console.log("Gas used:            ", receipt.gasUsed.toString());
  console.log("---");

  // I check all balances and the remaining allowance after the transfer
  const balanceAfter   = await token.balanceOf(deployer.address);
  const allowanceAfter = await token.allowance(deployer.address, SPENDER);
  const spenderBalance = await token.balanceOf(SPENDER);

  console.log("My balance after:       ", ethers.formatUnits(balanceAfter, 18), "CUSD");
  console.log("Spender balance after:  ", ethers.formatUnits(spenderBalance, 18), "CUSD");
  console.log("Allowance after:        ", ethers.formatUnits(allowanceAfter, 18), "CUSD");

  await connection.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
