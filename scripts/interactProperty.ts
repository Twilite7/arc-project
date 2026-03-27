import { network } from "hardhat";

const REGISTRY_ADDRESS = "0xC435b05C568aE2Be474C4E68448f9c7c504f3855";
const ESCROW_ADDRESS = "0xfc3553E0A744c0B2B0c9953B5cA215689ECB3C60";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const buyer = signers[1];

  console.log("Seller wallet:", deployer.address);
  console.log("Buyer wallet:", buyer.address);

  const registry = await ethers.getContractAt("PropertyRegistry", REGISTRY_ADDRESS, deployer);
  const escrow = await ethers.getContractAt("PropertyEscrow", ESCROW_ADDRESS, deployer);
  const escrowAsBuyer = await ethers.getContractAt("PropertyEscrow", ESCROW_ADDRESS, buyer);

  // ─── Step 1: Whitelist deployer as verified lister ───
  console.log("\n[1] Whitelisting deployer as verified lister...");
  const whitelistTx = await registry.setVerifiedLister(deployer.address, true);
  await whitelistTx.wait();
  console.log("Verified lister:", deployer.address);

  // ─── Step 2: Generate seller signature ───
  console.log("\n[2] Generating seller signature...");

  const location = "123 Victoria Island, Lagos, Nigeria";
  const latitude = "6.4281";
  const longitude = "3.4219";
  const size = "800 sqm";
  const price = ethers.parseEther("0.001");
  const description = "Waterfront commercial property with sea view";
  const docsHash = ethers.keccak256(ethers.toUtf8Bytes("property-legal-docs-v1"));

  const messageHash = ethers.solidityPackedKeccak256(
    ["string", "string", "string", "string", "uint256", "bytes32"],
    [location, latitude, longitude, size, price, docsHash]
  );
  const sellerSig = await deployer.signMessage(ethers.getBytes(messageHash));
  console.log("Seller signature generated");

  // ─── Step 3: List property ───
  console.log("\n[3] Listing property...");
  const listTx = await registry.listProperty(
    location,
    latitude,
    longitude,
    size,
    price,
    description,
    docsHash,
    sellerSig
  );
  await listTx.wait();
  const tokenId = await registry.tokenCount();
  console.log("Property listed — Token ID:", tokenId.toString());

  const property = await registry.getProperty(tokenId);
  console.log("Location:", property.location);
  console.log("GPS:", property.latitude, ",", property.longitude);
  console.log("Size:", property.size);
  console.log("Price:", ethers.formatEther(property.price), "ETH");
  console.log("Status:", ["Available", "InEscrow", "Sold"][property.status]);

  // ─── Step 4: Open deal ───
  console.log("\n[4] Opening escrow deal...");
  const openTx = await escrow.openDeal(tokenId);
  await openTx.wait();
  const dealId = await escrow.dealCount();
  console.log("Deal opened — Deal ID:", dealId.toString());

  const propAfterOpen = await registry.getProperty(tokenId);
  console.log("Property status:", ["Available", "InEscrow", "Sold"][propAfterOpen.status]);

  // ─── Step 5: Deposit as buyer ───
  console.log("\n[5] Depositing as buyer...");
  console.log("Buyer wallet:", buyer.address);

  const depositTx = await escrowAsBuyer.deposit(dealId, { value: price });
  await depositTx.wait();
  console.log("Deposited:", ethers.formatEther(price), "ETH into escrow");

  const escrowBalance = await ethers.provider.getBalance(ESCROW_ADDRESS);
  console.log("Escrow contract balance:", ethers.formatEther(escrowBalance), "ETH");

  // ─── Step 6: Buyer signs ───
  console.log("\n[6] Buyer signing deal...");

  const buyerMessageHash = ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "address", "address", "uint256"],
    [dealId, tokenId, deployer.address, buyer.address, price]
  );
  const buyerSig = await buyer.signMessage(ethers.getBytes(buyerMessageHash));
  console.log("Buyer signature generated");

  const signTx = await escrowAsBuyer.buyerSign(dealId, buyerSig);
  await signTx.wait();
  console.log("Buyer signed — deal finalizing...");

  // ─── Step 7: Verify deal completed ───
  console.log("\n[7] Verifying deal completion...");
  const deal = await escrow.getDeal(dealId);
  console.log("Deal status:", ["Open", "Completed", "Cancelled"][deal.status]);

  const propAfterSale = await registry.getProperty(tokenId);
  console.log("Property status:", ["Available", "InEscrow", "Sold"][propAfterSale.status]);
  console.log("New owner:", await registry.ownerOf(tokenId));

  const previousOwners = await registry.getPreviousOwners(tokenId);
  console.log("Previous owners:", previousOwners);

  // ─── Step 8: Withdraw funds as seller ───
  console.log("\n[8] Withdrawing seller funds...");
  const pending = await escrow.getPendingWithdrawal(deployer.address);
  console.log("Pending withdrawal:", ethers.formatEther(pending), "ETH");

  const withdrawTx = await escrow.withdrawFunds();
  await withdrawTx.wait();
  console.log("Funds withdrawn successfully");

  const pendingAfter = await escrow.getPendingWithdrawal(deployer.address);
  console.log("Pending after withdrawal:", ethers.formatEther(pendingAfter), "ETH");

  console.log("\n=== Full flow completed successfully ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
