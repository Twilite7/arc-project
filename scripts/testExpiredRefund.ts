import { network } from "hardhat";

const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC     = "0x3600000000000000000000000000000000000000";
const AMOUNT   = 1_000_000n;

const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function setBudget(uint256,uint256,bytes) external",
  "function fund(uint256,bytes) external",
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

  // I decode 0xf7a0748c to understand the createJob failure
  const errorCandidates = [
    "ExpiryTooShort()",
    "InvalidExpiry()",
    "ExpiryInPast()",
    "TooSoon()",
    "DeadlineTooShort()",
    "InvalidDeadline()",
  ];
  console.log("Decoding 0xf7a0748c:");
  for (const sig of errorCandidates) {
    const sel = ethers.id(sig).slice(0, 10);
    if (sel === "0xf7a0748c") console.log("MATCH:", sig);
    else console.log("     ", sel, sig);
  }

  // I try creating a job that expires in 60 seconds — minimum might be ~1 min
  const erc8183 = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const usdc    = await ethers.getContractAt(ERC20_ABI, USDC, deployer);

  // I try progressively longer expiries to find the minimum
  for (const seconds of [60, 300, 600, 3600]) {
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + seconds);
    try {
      await erc8183.createJob.staticCall(
        deployer.address, deployer.address, expiredAt, "test", ethers.ZeroAddress
      );
      console.log(`\nMinimum expiry: ${seconds} seconds (${seconds/60} minutes)`);
      break;
    } catch {
      console.log(`${seconds}s expiry: rejected`);
    }
  }

  await connection.close();
}
main().catch(console.error);
