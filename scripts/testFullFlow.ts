import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";
const USDC     = "0x3600000000000000000000000000000000000000";
const PRICE    = 22_000_000n;

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function fund(uint256,bytes) external",
  "function submit(uint256,bytes32,bytes) external",
  "function complete(uint256,bytes32,bytes) external",
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
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

  const balBefore = await usdc.balanceOf(DEPLOYER);
  console.log("Balance before:", ethers.formatUnits(balBefore, 6), "USDC");

  // 1 — createJob
  const tx1 = await erc8183.createJob(
    DEPLOYER, DEPLOYER, expiredAt, "full flow test", ethers.ZeroAddress
  );
  const r1 = await tx1.wait();
  const jobId = BigInt(r1.logs[0].topics[1]);
  console.log("1. createJob jobId:", jobId.toString());

  // 2 — approve + fund with price in optParams
  await (await usdc.approve(ERC8183, PRICE)).wait();
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [PRICE]);
  await (await erc8183.fund(jobId, encoded)).wait();
  console.log("2. funded:", ethers.formatUnits(PRICE, 6), "USDC");

  // 3 — submit deliverable
  const deliverable = ethers.keccak256(ethers.toUtf8Bytes("test-deliverable"));
  await (await erc8183.submit(jobId, deliverable, "0x")).wait();
  console.log("3. submitted deliverable");

  // 4 — complete
  const reason = ethers.keccak256(ethers.toUtf8Bytes("approved"));
  await (await erc8183.complete(jobId, reason, "0x")).wait();
  console.log("4. completed");

  // 5 — check balance increased
  const balAfter = await usdc.balanceOf(DEPLOYER);
  console.log("Balance after: ", ethers.formatUnits(balAfter, 6), "USDC");
  console.log("Net change:    ", ethers.formatUnits(balAfter - balBefore, 6), "USDC");

  // I read job state
  const job = await erc8183.jobs(jobId);
  console.log("Job status:    ", Number(job[7]), "(3=Completed)");
  console.log("Job budget:    ", ethers.formatUnits(job[5], 6), "USDC");

  await connection.close();
}

main().catch(console.error);
