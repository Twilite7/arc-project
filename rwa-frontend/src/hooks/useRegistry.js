import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow.json";
import { getNetwork } from "../config/networks.js";

const ARC_PUBLIC_RPC     = "https://arc-testnet.drpc.org";
const ROBINHOOD_PUBLIC_RPC = "https://robinhood-testnet.g.alchemy.com/v2/G3Xv9S7-fqFCrwMTQ2h7E";
const CHUNK_SIZE         = 9000;

// I return a public RPC provider for the given chainId — used when wallet not connected
function getPublicProvider(chainId) {
  if (chainId === 46630) return new ethers.JsonRpcProvider(ROBINHOOD_PUBLIC_RPC);
  return new ethers.JsonRpcProvider(ARC_PUBLIC_RPC);
}

export function useRegistry(signer, provider, chainId) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading]       = useState(false);

  // I derive network config from chainId — falls back to Arc if not connected
  // I only fetch when chainId is known — no silent fallback to Arc
  const netConfig = getNetwork(chainId);

  const getProvider = useCallback(() => {
    return provider || getPublicProvider(chainId || 5042002);
  }, [provider, chainId]);


  const getRegistry = useCallback((signerOrProvider) => {
    if (!netConfig) return null;
    return new ethers.Contract(netConfig.registry, RegistryABI.abi, signerOrProvider);
  }, [netConfig?.registry]);

  const getEscrow = useCallback((signerOrProvider) => {
    if (!netConfig) return null;
    return new ethers.Contract(netConfig.escrow, EscrowABI.abi, signerOrProvider);
  }, [netConfig?.escrow]);

  const fetchProperties = useCallback(async () => {
    if (!netConfig) { setProperties([]); return; }
    setLoading(true);
    try {
      const p        = getProvider();
      const registry = getRegistry(p);
      const currentBlock = await p.getBlockNumber();
      const deployBlock  = netConfig.deployBlock;

      // I paginate in 9000-block chunks to stay under free tier rate limits
      let allEvents = [];
      for (let from = deployBlock; from <= currentBlock; from += CHUNK_SIZE) {
        const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
        try {
          const chunk = await registry.queryFilter(
            registry.filters.PropertyListed(), from, to
          );
          allEvents = allEvents.concat(chunk);
        } catch (e) {
          console.warn(`Chunk ${from}-${to} failed:`, e.message);
        }
      }

      if (import.meta.env.DEV) console.log(`Found ${allEvents.length} PropertyListed events`);

      const props = await Promise.all(allEvents.map(async (e) => {
        const tokenId = e.args[0];
        const prop    = await registry.getProperty(tokenId);
        return {
          tokenId:     tokenId.toString(),
          location:    prop.location,
          latitude:    prop.latitude,
          longitude:   prop.longitude,
          size:        prop.size,
          price:       prop.price,
          description: prop.description,
          docsHash:    prop.docsHash,
          status:      Number(prop.status),
          owner:       await registry.ownerOf(tokenId),
        };
      }));

      setProperties(props);
    } catch (e) { console.error("fetchProperties error:", e); }
    setLoading(false);
  }, [getProvider, getRegistry, netConfig?.deployBlock]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  return {
    properties, loading, fetchProperties,
    getRegistry, getEscrow,
    REGISTRY_ADDRESS: netConfig?.registry,
    ESCROW_ADDRESS:   netConfig?.escrow,
  };
}
