import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy PropertyRegistry first
  console.log("\nDeploying PropertyRegistry...");
  const RegistryFactory = await ethers.getContractFactory("PropertyRegistry", deployer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("PropertyRegistry deployed to:", registryAddress);

  // Deploy PropertyEscrow with registry address
  console.log("\nDeploying PropertyEscrow...");
  const EscrowFactory = await ethers.getContractFactory("PropertyEscrow", deployer);
  const escrow = await EscrowFactory.deploy(
    registryAddress,
    100,            // 1% platform fee (100 basis points)
    deployer.address // fee recipient = deployer for now
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("PropertyEscrow deployed to:", escrowAddress);

  // Link escrow to registry
  console.log("\nLinking escrow to registry...");
  const tx = await registry.setEscrowContract(escrowAddress);
  await tx.wait();
  console.log("Escrow linked to registry successfully");

  // Verify the link
  const linkedEscrow = await registry.getEscrowContract();
  console.log("Verified escrow address on registry:", linkedEscrow);
  console.log("Link verified:", linkedEscrow === escrowAddress);

  console.log("\n=== Deployment Summary ===");
  console.log("Network:          ", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:         ", deployer.address);
  console.log("PropertyRegistry: ", registryAddress);
  console.log("PropertyEscrow:   ", escrowAddress);
  console.log("Platform fee:      1%");
  console.log("Fee recipient:    ", deployer.address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
