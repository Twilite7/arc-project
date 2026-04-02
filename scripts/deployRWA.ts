import { network } from "hardhat";

// I key XUSD addresses by chain ID — never hardcode a single network address
const XUSD: Record<number, string> = {
  5042002: "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5",  // Arc Testnet
  46630:   "0xF3632dA3ed3F24E8eF7ef95F9094c323C6457A2b",  // Robinhood Testnet
};

const PLATFORM_FEE_BPS = 100;   // 1%
const FEE_RECIPIENT    = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const { chainId } = await ethers.provider.getNetwork();
  const xusdAddress = XUSD[Number(chainId)];
  if (!xusdAddress) throw new Error(`No XUSD configured for chain ${chainId}`);

  console.log("Deploying with:", deployer.address);
  console.log("Chain ID:      ", Number(chainId));
  console.log("XUSD:          ", xusdAddress);

  // 1 — Deploy registry
  const RegistryFactory = await ethers.getContractFactory("PropertyRegistry", deployer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("PropertyRegistry:", registryAddress);

  // 2 — Deploy escrow with correct XUSD for this network
  const EscrowFactory = await ethers.getContractFactory("PropertyEscrow", deployer);
  const escrow = await EscrowFactory.deploy(
    registryAddress,
    xusdAddress,
    PLATFORM_FEE_BPS,
    FEE_RECIPIENT
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("PropertyEscrow:", escrowAddress);

  // 3 — Wire escrow into registry
  const tx = await registry.setEscrowContract(escrowAddress);
  await tx.wait();
  console.log("Escrow wired to registry");

  // 4 — Verify
  const wired = await registry.getEscrowContract();
  console.log("Verified escrow in registry:", wired);
  console.log(wired === escrowAddress ? "OK" : "MISMATCH — check manually");

  await connection.close();
}

main().catch(console.error);
