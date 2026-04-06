import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";
const USDC     = "0x3600000000000000000000000000000000000000";
const PRICE    = 22_000_000n;

// I test alternate signatures for fund and createJob
const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function setBudget(uint256,uint256,bytes) external",
  "function fund(uint256,bytes) external",
];
const ERC20_ABI = ["function approve(address,uint256) returns (bool)"];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const erc8183 = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const usdc    = await ethers.getContractAt(ERC20_ABI, USDC, deployer);
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

  // I create a job where deployer is both client and provider
  const tx = await erc8183.createJob(
    DEPLOYER, DEPLOYER, expiredAt, "fund test", ethers.ZeroAddress
  );
  const r = await tx.wait();
  const jobId = BigInt(r.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());

  // I set budget as provider (deployer)
  await (await erc8183.setBudget(jobId, PRICE, "0x")).wait();
  console.log("budget set:", PRICE.toString());

  // I approve and fund — passing price as optParams to see if it overrides budget
  await (await usdc.approve(ERC8183, PRICE * 2n)).wait();

  // I try fund with price encoded in optParams
  console.log("\nfund with empty optParams...");
  try {
    await erc8183.fund.staticCall(jobId, "0x");
    console.log("ALLOWED");
  } catch (e: any) {
    console.log("DENIED:", e.reason || e.message);
  }

  // I try fund with amount ABI-encoded in optParams
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [PRICE]);
  console.log("\nfund with amount in optParams...");
  try {
    await erc8183.fund.staticCall(jobId, encoded);
    console.log("ALLOWED with encoded amount");
  } catch (e: any) {
    console.log("DENIED:", e.reason || e.message);
  }

  await connection.close();
}

main().catch(console.error);
