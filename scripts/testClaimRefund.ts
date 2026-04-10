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

  // I create job where deployer=client=provider=evaluator for full control
  const tx1 = await erc8183.createJob(
    deployer.address, deployer.address, expiredAt, "refund test", ethers.ZeroAddress
  );
  const r1 = await tx1.wait();
  const jobId = BigInt(r1.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());

  // I setBudget as provider, fund as client
  await (await erc8183.setBudget(jobId, AMOUNT, "0x")).wait();
  console.log("setBudget: OK");

  await (await usdc.approve(ERC8183, AMOUNT)).wait();
  await (await erc8183.fund(jobId, "0x")).wait();

  const balAfterFund = await usdc.balanceOf(deployer.address);
  const erc8183AfterFund = await usdc.balanceOf(ERC8183);
  console.log("After fund — deployer:", ethers.formatUnits(balAfterFund, 6));
  console.log("After fund — ERC8183: ", ethers.formatUnits(erc8183AfterFund, 6));

  const job1 = await erc8183.jobs(jobId);
  console.log("Job status after fund:", Number(job1[7]), "(1=Funded)");
  console.log("Job budget after fund:", ethers.formatUnits(job1[5], 6));

  // I reject as evaluator
  await (await erc8183.reject(jobId, ethers.keccak256(ethers.toUtf8Bytes("test reject")), "0x")).wait();
  console.log("\nreject: OK");

  const job2 = await erc8183.jobs(jobId);
  console.log("Job status after reject:", Number(job2[7]), "(4=Rejected)");

  // I claimRefund as client
  const balBefore = await usdc.balanceOf(deployer.address);
  await (await erc8183.claimRefund(jobId)).wait();
  const balAfter = await usdc.balanceOf(deployer.address);
  console.log("\nclaimRefund: OK");
  console.log("Balance delta:", ethers.formatUnits(balAfter - balBefore, 6), "USDC");

  await connection.close();
}
main().catch(console.error);
