import { network } from "hardhat";

const ERC8183 = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const ABI = [
  "function paymentToken() external view returns (address)",
  "function getJob(uint256 jobId) external view returns (uint256,address,address,address,string,uint256,uint256,uint8,address)",
];

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;

  const contract = await ethers.getContractAt(ABI, ERC8183, ethers.provider);
  const token = await contract.paymentToken();
  console.log("Payment token:", token);
  console.log("Is Arc USDC:  ", token.toLowerCase() === "0x3600000000000000000000000000000000000000");

  await connection.close();
}

main().catch(console.error);
