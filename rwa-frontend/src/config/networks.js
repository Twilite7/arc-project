// I keep all network-specific config in one place — add new chains here only
export const NETWORKS = {
  5042002: {
    name: "Arc Testnet",
    registry: "0x14A435A1923Ef70d53BAD2AFa2d010ec8dAF5436",
    escrow:   "0xd1b862ebE8280fB07822677c480A65bC7B1EeA6D",
    xusd:     "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5",
    deployBlock: 34900000,
  },
  46630: {
    name: "Robinhood Testnet",
    registry: "0x4e20E35Cf505faFA36E21F3a9490e0A679DaFD89",
    escrow:   "0x1935A725A549d99aF460c7228f4444b59cfcC52e",
    xusd:     "0xF3632dA3ed3F24E8eF7ef95F9094c323C6457A2b",
    deployBlock: 28030000,
  },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(NETWORKS).map(Number);

// I return network config for the given chainId, or null if unsupported
export function getNetwork(chainId) {
  return NETWORKS[chainId] || null;
}
