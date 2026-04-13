import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow8183.json";
import { getNetwork } from "../config/networks.js";

const ARC_PUBLIC_RPC = "https://arc-testnet.drpc.org";
const CHUNK_SIZE     = 9000;

function getPublicProvider() {
  return new ethers.JsonRpcProvider(ARC_PUBLIC_RPC);
}

export function useRegistry(signer, provider, chainId) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading]       = useState(false);

  const netConfig = getNetwork(chainId);

  // I key the cache per registry address so redeployments auto-invalidate
  const CACHE_KEY = `zeno_props_${netConfig?.registry || "default"}`;

  const getProvider = useCallback(() => {
    return provider || getPublicProvider();
  }, [provider, chainId]);

  const getRegistry = useCallback((signerOrProvider) => {
    if (!netConfig) return null;
    return new ethers.Contract(netConfig.registry, RegistryABI.abi, signerOrProvider);
  }, [netConfig?.registry]);

  const getEscrow = useCallback((signerOrProvider) => {
    if (!netConfig) return null;
    return new ethers.Contract(netConfig.escrow, EscrowABI.abi, signerOrProvider);
  }, [netConfig?.escrow]);

  const fetchProperties = useCallback(async (force = false) => {
    if (!netConfig) { setProperties([]); return; }
    setLoading(true);
    try {
      const p        = getProvider();
      const registry = getRegistry(p);
      const currentBlock = await p.getBlockNumber();

      // I serve entirely from cache when block hasn't changed and not forced
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          if (cached.lastBlock === currentBlock && cached.props?.length) {
            setProperties(cached.props);
            setLoading(false);
            return;
          }
        } catch {}
      }

      // I load cached props to avoid re-fetching already-known tokens
      let fromBlock   = netConfig.deployBlock;
      let cachedProps = [];
      let cachedIds   = new Set();
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          if (cached.lastBlock && cached.props?.length) {
            fromBlock   = cached.lastBlock + 1;
            cachedProps = cached.props;
            cachedIds   = new Set(cachedProps.map(p => p.tokenId));
          }
        } catch {}
      }

      // I paginate in 9000-block chunks to stay under free tier rate limits
      let newEvents = [];
      for (let from = fromBlock; from <= currentBlock; from += CHUNK_SIZE) {
        const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
        try {
          const chunk = await registry.queryFilter(
            registry.filters.PropertyListed(), from, to
          );
          newEvents = newEvents.concat(chunk);
        } catch (e) {
          console.warn(`Chunk ${from}-${to} failed:`, e.message);
        }
      }

      if (import.meta.env.DEV)
        console.log(`Found ${newEvents.length} new PropertyListed events`);

      // I fetch data only for tokens not already in cache
      const newProps = await Promise.all(
        newEvents
          .filter(e => !cachedIds.has(e.args[0].toString()))
          .map(async (e) => {
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
          })
      );

      // I refresh status on cached props since status changes as deals progress
      const refreshedCache = await Promise.all(
        cachedProps.map(async (p) => {
          try {
            const prop = await registry.getProperty(BigInt(p.tokenId));
            return { ...p, status: Number(prop.status) };
          } catch { return p; }
        })
      );

      const merged = [...refreshedCache, ...newProps.filter(Boolean)];

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          lastBlock: currentBlock,
          props:     merged,
        }));
      } catch {}

      setProperties(merged);
    } catch (e) { console.error("fetchProperties error:", e); }
    setLoading(false);
  }, [getProvider, getRegistry, netConfig?.deployBlock, netConfig?.registry, CACHE_KEY]);

  // I force a full rescan and cache clear on demand
  const forceRefresh = useCallback(() => {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    fetchProperties(true);
  }, [fetchProperties, CACHE_KEY]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  return {
    properties, loading, fetchProperties, forceRefresh,
    getRegistry, getEscrow,
    netConfig,
    REGISTRY_ADDRESS: netConfig?.registry,
    ESCROW_ADDRESS:   netConfig?.escrow,
  };
}
