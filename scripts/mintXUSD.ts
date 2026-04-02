import { network } from "hardhat";

const RECIPIENT = "0x14F94f8bf5223C2a8BA90092c0F97dfF834C8Bba";
const AMOUNT    = "1000";

// I key XUSD addresses by chain ID
const XUSD: Record<number, string> = {
  5042002: "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5",  // Arc
  46630:   "0xF3632dA3ed3F24E8eF7ef95F9094c323C6457A2b",  // Robinhood
};

const ABI = ["function mint(address to, uint256 amount)"];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const { chainId } = await ethers.provider.getNetwork();
  const xusdAddress = XUSD[Number(chainId)];
  if (!xusdAddress) throw new Error(`No XUSD for chain ${chainId}`);

  const xusd = await ethers.getContractAt(ABI, xusdAddress, deployer);
  const tx = await xusd.mint(RECIPIENT, ethers.parseUnits(AMOUNT, 6));
  await tx.wait();
  console.log(`Minted ${AMOUNT} XUSD to ${RECIPIENT} on chain ${chainId}`);
  await connection.close();
}

main().catch(console.error);
