import { network } from "hardhat";

const USDC  = "0x3600000000000000000000000000000000000000";
const BUYER = "0x14F94f8bf5223C2a8BA90092c0F97dfF834C8Bba";
const DEPLOYER = "0x13E569C96c7F884443d0c3Ac5019D020dE32bFb3";

const ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const usdc = await ethers.getContractAt(ABI, USDC, ethers.provider);
  const [d, b] = await Promise.all([
    usdc.balanceOf(DEPLOYER),
    usdc.balanceOf(BUYER),
  ]);
  console.log("Deployer USDC:", ethers.formatUnits(d, 6));
  console.log("Buyer USDC:   ", ethers.formatUnits(b, 6));
  await connection.close();
}

main().catch(console.error);
