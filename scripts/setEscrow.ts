import { network } from "hardhat";
import RegistryABI from "../artifacts/contracts/PropertyRegistry.sol/PropertyRegistry.json";

const REGISTRY_ADDRESS   = "0xC435b05C568aE2Be474C4E68448f9c7c504f3855";
const NEW_ESCROW_ADDRESS = "0x92d3ee145273718d4CFf1Ece310EA24DCA6d41Ca";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Calling with account:", deployer.address);

  const registry = await ethers.getContractAt(
    RegistryABI.abi,
    REGISTRY_ADDRESS,
    deployer
  );

  const current = await registry.getEscrowContract();
  console.log("Current escrow:", current);

  const tx = await registry.setEscrowContract(NEW_ESCROW_ADDRESS);
  await tx.wait();

  const updated = await registry.getEscrowContract();
  console.log("New escrow set to:", updated);

  await connection.close();
}

main().catch(console.error);
