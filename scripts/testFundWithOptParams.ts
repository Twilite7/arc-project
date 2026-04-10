import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC     = "0x3600000000000000000000000000000000000000";
const AMOUNT   = 2_000_000n; // 2 USDC exactly

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function fund(uint256,bytes) external",
  "function jobs(uint256) view returns (uint256,address,address,address,string,uint256,uint256,uint8,address,bytes32)",
];
const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const erc8183 = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const usdc    = await ethers.getContractAt(ERC20_ABI, USDC, deployer);

  const deployerBefore = await usdc.balanceOf(deployer.address);
  const erc8183Before  = await usdc.balanceOf(ERC8183);
  console.log("Deployer before: ", ethers.formatUnits(deployerBefore, 6));
  console.log("ERC8183 before:  ", ethers.formatUnits(erc8183Before, 6));

  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);
  const tx1 = await erc8183.createJob(
    deployer.address, deployer.address, expiredAt, "fund optparams test", ethers.ZeroAddress
  );
  const r1 = await tx1.wait();
  const jobId = BigInt(r1.logs[0].topics[1]);
  console.log("\njobId:", jobId.toString());

  // I approve exactly AMOUNT to ERC8183
  await (await usdc.approve(ERC8183, AMOUNT)).wait();
  console.log("Approved:", ethers.formatUnits(AMOUNT, 6), "USDC");

  // I fund with AMOUNT encoded in optParams
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [AMOUNT]);
  const fundTx = await erc8183.fund(jobId, encoded);
  await fundTx.wait();
  console.log("fund() called with encoded amount:", ethers.formatUnits(AMOUNT, 6));

  const deployerAfter = await usdc.balanceOf(deployer.address);
  const erc8183After  = await usdc.balanceOf(ERC8183);
  console.log("\nDeployer after:  ", ethers.formatUnits(deployerAfter, 6));
  console.log("ERC8183 after:   ", ethers.formatUnits(erc8183After, 6));
  console.log("Deployer delta:  ", ethers.formatUnits(deployerAfter - deployerBefore, 6));
  console.log("ERC8183 delta:   ", ethers.formatUnits(erc8183After  - erc8183Before,  6));

  // I check job state after fund
  const job = await erc8183.jobs(jobId);
  console.log("\nJob status:", Number(job[7]), "(1=Funded)");
  console.log("Job budget:", ethers.formatUnits(job[5], 6), "USDC");

  await connection.close();
}
main().catch(console.error);
