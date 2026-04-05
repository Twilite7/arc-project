// I keep all network config in one place — Arc Testnet only, ERC-8183 native
export const NETWORKS = {
  5042002: {
    name:        "Arc Testnet",
    registry:    "0x6078713c95c0c0B008521B083c424771f2F8C0b0",
    escrow:      "0xCBD51f24EE2E00949AC2E90B26d62917685f8bcF",
    usdc:        "0x3600000000000000000000000000000000000000",
    erc8183:     "0x0747EEf0706327138c69792bF28Cd525089e4583",
    deployBlock: 35100000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

// I return network config for the given chainId, or null if unsupported
export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
