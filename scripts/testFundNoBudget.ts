import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";
const USDC     = "0x3600000000000000000000000000000000000000";
const PRICE    = 22_000_000n;

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

  // I create job with deployer as both client and provider — NO setBudget call
  const tx = await erc8183.createJob(
    DEPLOYER, DEPLOYER, expiredAt, "no-budget fund test", ethers.ZeroAddress
  );
  const r = await tx.wait();
  const jobId = BigInt(r.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());
  console.log("No setBudget called");

  await (await usdc.approve(ERC8183, PRICE)).wait();

  // I try to fund with amount encoded in optParams, skipping setBudget
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [PRICE]);
  console.log("fund with amount in optParams (no prior setBudget)...");
  try {
    const fundTx = await erc8183.fund(jobId, encoded);
    await fundTx.wait();
    console.log("FUNDED — setBudget not required");
  } catch (e: any) {
    console.log("FAILED:", e.reason || e.message);
  }

  // I also try plain fund with no optParams
  const tx2 = await erc8183.createJob(
    DEPLOYER, DEPLOYER, expiredAt, "no-budget plain fund", ethers.ZeroAddress
  );
  const r2 = await tx2.wait();
  const jobId2 = BigInt(r2.logs[0].topics[1]);
  console.log("\njobId2:", jobId2.toString());

  await (await usdc.approve(ERC8183, PRICE)).wait();
  console.log("fund with empty optParams (no prior setBudget)...");
  try {
    const fundTx2 = await erc8183.fund(jobId2, "0x");
    await fundTx2.wait();
    console.log("FUNDED — setBudget not required");
  } catch (e: any) {
    console.log("FAILED:", e.reason || e.message);
  }

  await connection.close();
}

main().catch(console.error);
