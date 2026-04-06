// I keep all network config in one place — Arc Testnet only, ERC-8183 native
export const NETWORKS = {
  5042002: {
    name:        "Arc Testnet",
    registry:    "0x1D86e73C9946847CC645337F2aEfA7F538a6E868",
    escrow:      "0xA07885Ad7092584bBb78FbEf2864e6ff3b9Ffb7D",
    usdc:        "0x3600000000000000000000000000000000000000",
    erc8183:     "0x0747EEf0706327138c69792bF28Cd525089e4583",
    deployBlock: 35200000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

// I return network config for the given chainId, or null if unsupported
export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
