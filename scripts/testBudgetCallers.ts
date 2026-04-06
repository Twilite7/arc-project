import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";
const BUYER    = "0x14F94f8bf5223C2a8BA90092c0F97dfF834C8Bba";
const PRICE    = 22_000_000n;

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function setBudget(uint256,uint256,bytes) external",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const erc8183 = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

  // I create job: deployer=client, BUYER=provider, deployer=evaluator
  // This mirrors real flow: escrow=client, seller=provider, admin=evaluator
  console.log("Creating job: client=deployer, provider=buyer...");
  const tx = await erc8183.createJob(
    BUYER, DEPLOYER, expiredAt, "budget caller test", ethers.ZeroAddress
  );
  const r = await tx.wait();
  const jobId = BigInt(r.logs[0].topics[1]);
  console.log("jobId:", jobId.toString());

  // I test setBudget from deployer — who is client+evaluator but NOT provider
  console.log("\nsetBudget from deployer (client/evaluator, not provider)...");
  try {
    await erc8183.setBudget.staticCall(jobId, PRICE, "0x");
    console.log("ALLOWED");
  } catch (e: any) {
    console.log("DENIED:", e.reason || e.message);
  }

  // I test setBudget with a different signer — need buyer's key
  // For now test if the call works with deployer as provider instead
  console.log("\nCreating job where deployer=client=provider=evaluator...");
  const tx2 = await erc8183.createJob(
    DEPLOYER, DEPLOYER, expiredAt, "self test", ethers.ZeroAddress
  );
  const r2 = await tx2.wait();
  const jobId2 = BigInt(r2.logs[0].topics[1]);
  console.log("jobId2:", jobId2.toString());

  console.log("setBudget from deployer (is provider here)...");
  try {
    await erc8183.setBudget.staticCall(jobId2, PRICE, "0x");
    console.log("ALLOWED — provider can set budget");
  } catch (e: any) {
    console.log("DENIED:", e.reason || e.message);
  }

  await connection.close();
}

main().catch(console.error);
