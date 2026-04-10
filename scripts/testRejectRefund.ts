import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC     = "0x3600000000000000000000000000000000000000";
const AMOUNT   = 2_000_000n;

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function setBudget(uint256,uint256,bytes) external",
  "function fund(uint256,bytes) external",
  "function reject(uint256,bytes32,bytes) external",
  "function claimRefund(uint256) external",
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

  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);
  const tx1 = await erc8183.createJob(
    deployer.address, deployer.address, expiredAt, "reject refund test", ethers.ZeroAddress
  );
  const r1 = await tx1.wait();
  const jobId = BigInt(r1.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());

  await (await erc8183.setBudget(jobId, AMOUNT, "0x")).wait();
  await (await usdc.approve(ERC8183, AMOUNT)).wait();
  await (await erc8183.fund(jobId, "0x")).wait();

  const balBeforeReject = await usdc.balanceOf(deployer.address);
  const erc8183BeforeReject = await usdc.balanceOf(ERC8183);
  console.log("\nBefore reject:");
  console.log("  deployer: ", ethers.formatUnits(balBeforeReject, 6));
  console.log("  ERC8183:  ", ethers.formatUnits(erc8183BeforeReject, 6));

  // I reject and immediately check balances — does ERC-8183 auto-refund client?
  await (await erc8183.reject(jobId, ethers.keccak256(ethers.toUtf8Bytes("test")), "0x")).wait();

  const balAfterReject = await usdc.balanceOf(deployer.address);
  const erc8183AfterReject = await usdc.balanceOf(ERC8183);
  console.log("\nAfter reject:");
  console.log("  deployer: ", ethers.formatUnits(balAfterReject, 6));
  console.log("  ERC8183:  ", ethers.formatUnits(erc8183AfterReject, 6));
  console.log("  deployer delta:", ethers.formatUnits(balAfterReject - balBeforeReject, 6));
  console.log("  ERC8183 delta: ", ethers.formatUnits(erc8183AfterReject - erc8183BeforeReject, 6));

  await connection.close();
}
main().catch(console.error);
