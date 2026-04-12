import { network } from "hardhat";

const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const IDENTITY_REGISTRY   = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

const VALIDATION_ABI = [
  "function validationRequest(address,uint256,string,bytes32) external",
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,uint8,string,uint256)",
];
const IDENTITY_ABI = [
  "function register(string) external returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const identity   = await ethers.getContractAt(IDENTITY_ABI, IDENTITY_REGISTRY, deployer);
  const validation = await ethers.getContractAt(VALIDATION_ABI, VALIDATION_REGISTRY, deployer);

  // I register fresh identity
  const regTx = await identity.register("ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei");
  const r = await regTx.wait();
  const agentId = BigInt(r.logs[0].topics[3]);
  console.log("agentId:", agentId.toString());
  console.log("owner:  ", await identity.ownerOf(agentId));

  const reqHash = ethers.keccak256(ethers.toUtf8Bytes("auth-test-" + Date.now()));

  // I test 1: caller=agentOwner, validator=deployer (same address — worked before)
  console.log("\nTest 1: caller=owner, validator=owner...");
  try {
    await (await validation.validationRequest(DEPLOYER, agentId, "ipfs://test", reqHash)).wait();
    console.log("OK");
  } catch (e: any) { console.log("FAILED:", e.reason || e.message); }

  // I test 2: try with a different validator address (some random address)
  const reqHash2 = ethers.keccak256(ethers.toUtf8Bytes("auth-test2-" + Date.now()));
  const RANDOM = "0x000000000000000000000000000000000000dEaD";
  console.log("\nTest 2: caller=owner, validator=random...");
  try {
    await (await validation.validationRequest(RANDOM, agentId, "ipfs://test", reqHash2)).wait();
    console.log("OK");
  } catch (e: any) { console.log("FAILED:", e.reason || e.message); }

  await connection.close();
}
main().catch(console.error);
