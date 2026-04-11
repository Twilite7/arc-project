import { network } from "hardhat";

const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const PASS_HASH = "0xf22d80b20f13d60298d439637963cbd6309aff5438f5958b18359904b99970a7";

const VALIDATION_ABI = [
  "function getValidationStatus(bytes32) view returns (address validator, uint256 agentId, uint8 score, uint8 status, string tags, uint256 timestamp)",
  "function validationRequest(address,uint256,string,bytes32) external",
  "function validationResponse(bytes32,uint8,string,bytes32,string) external",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const validation = await ethers.getContractAt(VALIDATION_ABI, VALIDATION_REGISTRY, ethers.provider);

  // I decode the pass result
  const result = await validation.getValidationStatus(PASS_HASH);
  console.log("validator:", result[0]);
  console.log("agentId:  ", result[1].toString());
  console.log("score:    ", result[2].toString());
  console.log("status:   ", result[3].toString());
  console.log("tags:     ", result[4]);
  console.log("timestamp:", result[5].toString());

  // I also test the fail hash
  // First submit a new fail case
  const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
  const identity = await ethers.getContractAt(
    ["function register(string) external returns (uint256)"],
    IDENTITY_REGISTRY, deployer
  );
  const validationW = await ethers.getContractAt(VALIDATION_ABI, VALIDATION_REGISTRY, deployer);

  const failHash = ethers.keccak256(ethers.toUtf8Bytes("fail-verify-" + Date.now()));
  const regTx = await identity.register("ipfs://test");
  const r = await regTx.wait();
  const agentId = BigInt(r.logs[0].topics[3]);

  await (await validationW.validationRequest(deployer.address, agentId, "ipfs://test", failHash)).wait();
  await (await validationW.validationResponse(failHash, 0, "invalid", ethers.ZeroHash, "rejected")).wait();

  const failResult = await validation.getValidationStatus(failHash);
  console.log("\nFail result score:", failResult[2].toString());
  console.log("Fail result tags: ", failResult[4]);

  await connection.close();
}
main().catch(console.error);
