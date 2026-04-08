import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";
const BUYER    = "0x14F94f8bf5223C2a8BA90092c0F97dfF834C8Bba";
const USDC     = "0x3600000000000000000000000000000000000000";
const PRICE    = 5_500_000n;

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function fund(uint256,bytes) external",
  "function submit(uint256,bytes32,bytes) external",
];
const ERC20_ABI = ["function approve(address,uint256) returns (bool)"];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const erc8183 = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const usdc    = await ethers.getContractAt(ERC20_ABI, USDC, deployer);
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

  // I create job: deployer=client, BUYER=provider, deployer=evaluator
  // This mirrors real flow: escrow=client, seller=provider, admin=evaluator
  console.log("Creating job: client=deployer, provider=BUYER...");
  const tx = await erc8183.createJob(
    BUYER, DEPLOYER, expiredAt, "submit caller test", ethers.ZeroAddress
  );
  const r = await tx.wait();
  const jobId = BigInt(r.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());

  // I fund from deployer (client)
  await (await usdc.approve(ERC8183, PRICE)).wait();
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [PRICE]);
  await (await erc8183.fund(jobId, encoded)).wait();
  console.log("funded");

  // I try submit from deployer (client/evaluator, NOT provider)
  const deliverable = ethers.keccak256(ethers.toUtf8Bytes("test"));
  console.log("\nsubmit from deployer (not provider)...");
  try {
    await erc8183.submit.staticCall(jobId, deliverable, "0x");
    console.log("ALLOWED — client can submit");
  } catch (e: any) {
    console.log("DENIED:", e.reason || e.message);
    console.log("submit also requires provider — this is the bug");
  }

  await connection.close();
}

main().catch(console.error);
