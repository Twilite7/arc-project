// I keep all network config in one place — Arc Testnet only, ERC-8183 native
export const NETWORKS = {
  5042002: {
    name:        "Arc Testnet",
    registry:    "0x731488187e5ADF756C5C8DfA5106551dfCe1dB81",
    escrow:      "0x3Aa2Bc6D5aF9349811f994bE61233E3E869fb145",
    usdc:        "0x3600000000000000000000000000000000000000",
    erc8183:     "0x0747EEf0706327138c69792bF28Cd525089e4583",
    deployBlock: 36700000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
