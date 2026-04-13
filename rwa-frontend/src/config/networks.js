// I keep all network config in one place — Arc Testnet only, ERC-8183 and ERC-8004 native
export const NETWORKS = {
  5042002: {
    name:              "Arc Testnet",
    registry:          "0xB729E2d854FAfF042236eb1D6039dd0495843982",
    escrow:            "0x47B98EC974ab77a27F04723DAC8036535132FC15",
    usdc:              "0x3600000000000000000000000000000000000000",
    erc8183:           "0x0747EEf0706327138c69792bF28Cd525089e4583",
    erc8004Identity:   "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    erc8004Validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    deployBlock:       36400000,
  },
};

export const SUPPORTED_CHAIN_IDS = [5042002];

export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
