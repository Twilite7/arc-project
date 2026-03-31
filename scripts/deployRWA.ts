import { network } from "hardhat";

// I deploy registry first, then escrow with registry address, then wire them together
const XUSD_ADDRESS     = "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5";
const PLATFORM_FEE_BPS = 100;   // 1%
const FEE_RECIPIENT    = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1 — Deploy registry
  const RegistryFactory = await ethers.getContractFactory("PropertyRegistry", deployer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("PropertyRegistry:", registryAddress);

  // 2 — Deploy escrow, passing registry + XUSD
  const EscrowFactory = await ethers.getContractFactory("PropertyEscrow", deployer);
  const escrow = await EscrowFactory.deploy(
    registryAddress,
    XUSD_ADDRESS,
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
