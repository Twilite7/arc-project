import { network } from "hardhat";

async function main() {
  const CONTRACT_ADDRESS = "0x9Cab223CC238602dbd9d7c438E0aa9Ac89382090";

  const connection = await network.connect("arcTestnet");
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Reading from address:", deployer.address);
  console.log("---");

  const abi = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ];

  const token = await ethers.getContractAt(abi, CONTRACT_ADDRESS, deployer);

  const name        = await token.name();
  const symbol      = await token.symbol();
  const decimals    = await token.decimals();
  const totalSupply = await token.totalSupply();
  const balance     = await token.balanceOf(deployer.address);
  const allowance   = await token.allowance(deployer.address, ethers.ZeroAddress);

  console.log("name()        →", name);
  console.log("symbol()      →", symbol);
  console.log("decimals()    →", decimals.toString());
  console.log("totalSupply() →", totalSupply.toString(), "(raw)");
  console.log("balanceOf()   →", balance.toString(), "(raw)");
  console.log("allowance()   →", allowance.toString(), "(raw)");
  console.log("---");
  console.log("totalSupply (formatted) →", ethers.formatUnits(totalSupply, decimals), symbol);
  console.log("balance     (formatted) →", ethers.formatUnits(balance, decimals), symbol);

  await connection.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
