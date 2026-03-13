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
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
});
