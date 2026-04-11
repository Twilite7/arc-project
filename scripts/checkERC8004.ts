import { network } from "hardhat";

const IDENTITY_REGISTRY   = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const sigs = [
  "validationRequest(address,uint256,string,bytes32)",
  "validationResponse(bytes32,uint8,string,bytes32,string)",
  "getValidationStatus(bytes32)",
  "getValidation(bytes32)",
  "validations(bytes32)",
  "isValidated(uint256)",
  "isValidated(address,uint256)",
  "getValidationResult(bytes32)",
  "requestValidation(address,uint256,string,bytes32)",
  "respondValidation(bytes32,uint8,string,bytes32,string)",
  "register(string)",
  "register()",
  "ownerOf(uint256)",
  "tokenURI(uint256)",
  "getMetadata(uint256,string)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;

  for (const [name, proxy] of [
    ["IdentityRegistry",   IDENTITY_REGISTRY],
    ["ValidationRegistry", VALIDATION_REGISTRY],
    ["ReputationRegistry", REPUTATION_REGISTRY],
  ]) {
    const raw  = await ethers.provider.getStorage(proxy, IMPL_SLOT);
    const impl = "0x" + raw.slice(-40);
    const code = await ethers.provider.getCode(impl);
    console.log(`\n=== ${name} ===`);
    console.log("Impl:", impl);
    console.log("Impl bytecode length:", code.length);

    for (const sig of sigs) {
      const sel = ethers.id(sig).slice(2, 10);
      if (code.includes(sel)) {
        console.log("  FOUND:", "0x" + sel, sig);
      }
    }
  }

  await connection.close();
}
main().catch(console.error);
