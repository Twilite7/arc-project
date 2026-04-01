import { network } from "hardhat";

const REGISTRY = "0x14A435A1923Ef70d53BAD2AFa2d010ec8dAF5436";

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;
  const provider = ethers.provider;

  // I get the deploy block from the contract's creation transaction
  // getTransactionCount at block 0 won't work on pruned nodes, so I check recent history
  const latest = await provider.getBlockNumber();
  console.log("Latest block:", latest);

  // I scan backwards through recent blocks to find the PropertyListed or contract deploy tx
  // The registry emits no event on deploy, so I look for zero-to-code transition in recent range
  // Faster approach: check the deployer's nonce history isn't available, so use creation code match
  
  // I use getLogs for the EscrowContractSet event which fires on deploy+wire
  const logs = await provider.getLogs({
    address: REGISTRY,
    fromBlock: latest - 500000,
    toBlock: "latest",
  });

  if (logs.length === 0) {
    console.log("No logs found — try a wider range");
  } else {
    console.log("First log at block:", logs[0].blockNumber);
    console.log("Use this as DEPLOY_BLOCK");
  }

  await connection.close();
}

main().catch(console.error);
