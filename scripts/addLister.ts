import { network } from "hardhat";

const LISTER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

// I key registries by chain ID — reliable across Hardhat v2 and v3
const REGISTRIES: Record<number, string> = {
  5042002: "0x14A435A1923Ef70d53BAD2AFa2d010ec8dAF5436",  // Arc Testnet
  46630:   "0x5913212dC860470F3267A1D8E0183b41e0d27348",  // Robinhood Testnet
};

const ABI = ["function setVerifiedLister(address lister, bool status) external"];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const { chainId } = await ethers.provider.getNetwork();
  const registryAddress = REGISTRIES[Number(chainId)];
  if (!registryAddress) throw new Error(`No registry configured for chain ID ${chainId}`);

  console.log(`Chain ${chainId} — adding lister: ${LISTER}`);
  const registry = await ethers.getContractAt(ABI, registryAddress, deployer);
  const tx = await registry.setVerifiedLister(LISTER, true);
  await tx.wait();
  console.log("Done.");
  await connection.close();
}

main().catch(console.error);
