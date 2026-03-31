import { network } from "hardhat";

const REGISTRY_ADDRESS    = "0xC435b05C568aE2Be474C4E68448f9c7c504f3855";
const XUSD_ADDRESS_ARC    = "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5";
const PLATFORM_FEE_BPS    = 100;  // 1%
const FEE_RECIPIENT       = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Factory = await ethers.getContractFactory("PropertyEscrow", deployer);
  const contract = await Factory.deploy(
    REGISTRY_ADDRESS,
    XUSD_ADDRESS_ARC,
    PLATFORM_FEE_BPS,
    FEE_RECIPIENT
  );
  await contract.waitForDeployment();

  console.log("PropertyEscrow deployed to:", await contract.getAddress());
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
