// I keep all network config in one place — Arc Testnet only, ERC-8183 native
export const NETWORKS = {
  5042002: {
    name:        "Arc Testnet",
    registry:    "0xe28C9187E68d0c3B3e430eCf5351f103744Fe773",
    escrow:      "0xFDAcBEa712ab342Fc513Ab3dC44EE425B13ffaa8",
    usdc:        "0x3600000000000000000000000000000000000000",
    erc8183:     "0x0747EEf0706327138c69792bF28Cd525089e4583",
    deployBlock: 36200000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
