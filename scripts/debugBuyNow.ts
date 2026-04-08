import { network } from "hardhat";

const REGISTRY = "0x1D86e73C9946847CC645337F2aEfA7F538a6E868";
const ESCROW   = "0xA07885Ad7092584bBb78FbEf2864e6ff3b9Ffb7D";
const ERC8183  = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC     = "0x3600000000000000000000000000000000000000";
const TOKEN_ID = 1n;

const REGISTRY_ABI = [
  "function getProperty(uint256) view returns (tuple(string,string,string,string,uint256,string,bytes32,bytes,uint8,address[]))",
  "function ownerOf(uint256) view returns (address)",
  "function updateStatus(uint256,uint8) external",
];
const ERC8183_ABI = [
  "function createJob(address,address,uint256,string,address) returns (uint256)",
  "function fund(uint256,bytes) external",
  "function submit(uint256,bytes32,bytes) external",
];
const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function transferFrom(address,address,uint256) returns (bool)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const registry = await ethers.getContractAt(REGISTRY_ABI, REGISTRY, deployer);
  const erc8183  = await ethers.getContractAt(ERC8183_ABI, ERC8183, deployer);
  const usdc     = await ethers.getContractAt(ERC20_ABI, USDC, deployer);

  const prop   = await registry.getProperty(TOKEN_ID);
  const seller = await registry.ownerOf(TOKEN_ID);
  const price  = prop[4];
  console.log("Price:", ethers.formatUnits(price, 6), "USDC");
  console.log("Seller:", seller);

  // I approve deployer's USDC to this script (simulating buyer approve to escrow)
  console.log("\n1. approve USDC to deployer (simulating escrow pull)...");
  await (await usdc.approve(deployer.address, price)).wait();
  console.log("   OK");

  // I simulate safeTransferFrom: pull price from deployer into deployer
  // (in real flow: escrow pulls from buyer into itself)
  const balBefore = await usdc.balanceOf(deployer.address);
  console.log("2. transferFrom self->self...");
  try {
    await (await usdc.transferFrom(deployer.address, deployer.address, price)).wait();
    console.log("   OK");
  } catch (e: any) { console.log("   FAILED:", e.reason || e.message); return; }

  // I approve ERC8183 to pull USDC (simulating forceApprove inside escrow)
  console.log("3. approve USDC to ERC8183...");
  await (await usdc.approve(ERC8183, price)).wait();
  console.log("   OK");

  // I createJob
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);
  console.log("4. createJob (seller=provider, deployer=evaluator)...");
  let jobId: bigint;
  try {
    const tx = await erc8183.createJob(
      seller, deployer.address, expiredAt,
      `Zeno Estate property #${TOKEN_ID}`, ethers.ZeroAddress
    );
    const r = await tx.wait();
    jobId = BigInt(r.logs[0].topics[1]);
    console.log("   OK jobId:", jobId.toString());
  } catch (e: any) { console.log("   FAILED:", e.reason || e.message); return; }

  // I fund with price in optParams
  console.log("5. fund with price in optParams...");
  try {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [price]);
    await (await erc8183.fund(jobId!, encoded)).wait();
    console.log("   OK");
  } catch (e: any) { console.log("   FAILED:", e.reason || e.message); return; }

  // I submit deliverable
  console.log("6. submit deliverable...");
  try {
    const deliverable = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256","address","address"], [TOKEN_ID, deployer.address, seller]
      )
    );
    await (await erc8183.submit(jobId!, deliverable, "0x")).wait();
    console.log("   OK");
  } catch (e: any) { console.log("   FAILED:", e.reason || e.message); return; }

  // I updateStatus in registry (simulating escrow calling onlyEscrow function)
  console.log("7. registry.updateStatus (will fail — deployer is not escrow)...");
  try {
    await (await registry.updateStatus(TOKEN_ID, 1)).wait();
    console.log("   OK");
  } catch (e: any) { console.log("   FAILED (expected):", e.reason || e.message); }

  console.log("\nAll ERC-8183 steps passed. Issue is in registry.updateStatus onlyEscrow check.");
  await connection.close();
}

main().catch(console.error);
