// I keep all network config in one place — Arc Testnet only, ERC-8183 native
export const NETWORKS = {
  5042002: {
    name:        "Arc Testnet",
    registry:    "0x20C8451f30baE423Ff3eA6F656F04FcD8e681905",
    escrow:      "0xe837aAFE1694Ad594b489e18b0A66662D0a132e2",
    usdc:        "0x3600000000000000000000000000000000000000",
    erc8183:     "0x0747EEf0706327138c69792bF28Cd525089e4583",
    deployBlock: 36400000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
