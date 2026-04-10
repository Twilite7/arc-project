import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;

  // I brute force common ERC-8183 error signatures to find 0x8e78f0cb
  const candidates = [
    "InvalidJobStatus(uint8)",
    "InvalidJobStatus()",
    "NotClient()",
    "NotProvider()",
    "NotEvaluator()",
    "JobExpired()",
    "JobNotFunded()",
    "AlreadyClaimed()",
    "RefundNotAvailable()",
    "CannotRefund()",
    "NotRefundable()",
    "RefundUnavailable()",
    "ClaimRefundFailed()",
    "InvalidState()",
    "InvalidState(uint8)",
    "WrongStatus()",
    "WrongStatus(uint8)",
    "NotExpired()",
    "OnlyClient()",
    "OnlyProvider()",
    "OnlyEvaluator()",
    "Unauthorized(address)",
    "Unauthorized()",
    "InvalidCaller()",
    "InvalidCaller(address)",
  ];

  console.log("Target: 0x8e78f0cb\n");
  for (const sig of candidates) {
    const sel = ethers.id(sig).slice(0, 10);
    if (sel === "0x8e78f0cb") console.log("MATCH:", sig);
    else console.log("     ", sel, sig);
  }

  await connection.close();
}
main().catch(console.error);
