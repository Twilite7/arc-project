import { network } from "hardhat";

const REGISTRY = "0x14A435A1923Ef70d53BAD2AFa2d010ec8dAF5436";
const ABI = [
  "function escrowLocked() external view returns (bool)",
  "function getEscrowContract() external view returns (address)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const registry = await ethers.getContractAt(ABI, REGISTRY, ethers.provider);
  console.log("Escrow locked:  ", await registry.escrowLocked());
  console.log("Current escrow: ", await registry.getEscrowContract());
  await connection.close();
}

main().catch(console.error);
