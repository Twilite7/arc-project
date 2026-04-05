import { network } from "hardhat";

// I deploy a fresh PropertyRegistry + PropertyEscrow8183 wired together
// Arc Testnet only — ERC-8183 is Arc-native

const PLATFORM_FEE_RECIPIENT = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) !== 5042002) throw new Error("Arc Testnet only (5042002)");

  console.log("Deployer:", deployer.address);
  console.log("Chain:   ", Number(chainId));

  // 1 — Deploy fresh registry
  const RegistryFactory = await ethers.getContractFactory("PropertyRegistry", deployer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("PropertyRegistry:   ", registryAddress);

  // 2 — Deploy Escrow8183 pointing at the new registry
  const EscrowFactory = await ethers.getContractFactory("PropertyEscrow8183", deployer);
  const escrow = await EscrowFactory.deploy(registryAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("PropertyEscrow8183: ", escrowAddress);

  // 3 — Wire escrow into registry
  const tx = await registry.setEscrowContract(escrowAddress);
  await tx.wait();
  console.log("Escrow wired to registry");

  // 4 — Add deployer as verified lister
  const listerTx = await registry.setVerifiedLister(deployer.address, true);
  await listerTx.wait();
  console.log("Deployer added as lister");

  // 5 — Verify
  const wired = await registry.getEscrowContract();
  const locked = await registry.escrowLocked();
  console.log("Wired escrow:", wired);
  console.log("Locked:      ", locked);
  console.log(wired.toLowerCase() === escrowAddress.toLowerCase() ? "OK" : "MISMATCH");

  await connection.close();
}

main().catch(console.error);
