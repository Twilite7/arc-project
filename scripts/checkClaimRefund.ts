import { network } from "hardhat";

const IMPL = "0xa316fd02827242d537f84730f8a37d0ba5fd351a";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;

  const sigs = [
    "claimRefund(uint256)",
    "claimRefund(uint256,bytes)",
    "refund(uint256)",
    "withdraw(uint256)",
  ];

  const code = await ethers.provider.getCode(IMPL);
  for (const sig of sigs) {
    const sel = ethers.id(sig).slice(2, 10);
    console.log(code.includes(sel) ? "FOUND" : "     ", "0x" + sel, sig);
  }

  await connection.close();
}
main().catch(console.error);
