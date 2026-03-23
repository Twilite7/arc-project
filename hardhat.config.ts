import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: "0.8.28",
  networks: {
    arcTestnet: {
      type: "http",
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      chainId: 5042002, // Arc Testnet chain ID
      accounts: [process.env.PRIVATE_KEY!],
    },
    robinhood: {
      type: "http",
      url: "https://rpc.testnet.chain.robinhood.com",
      accounts: [process.env.PRIVATE_KEY!],
      chainId: 46630,
    }
  },
});
