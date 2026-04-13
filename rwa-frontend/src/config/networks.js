// I keep all network config in one place — Arc Testnet only, ERC-8183 and ERC-8004 native
export const NETWORKS = {
  5042002: {
    name:              "Arc Testnet",
    registry:          "0x6538b6E36b4Ff9fe36Ea300fD173b4dAc8E2DbCB",
    escrow:            "0xC42072C43C86C3bA625D6eF9771fB59B827B35dd",
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
