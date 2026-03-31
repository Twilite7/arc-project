import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow.json";

const REGISTRY_ADDRESS = "0x6DCD95DD67c342EbfdF4355ef97f1A1ee9553028";
const ESCROW_ADDRESS   = "0x701FfaaE7a48C7756B2F6115EDC09A8E0331BCf0";
const PUBLIC_RPC       = "https://arc-testnet.drpc.org";
const CHUNK_SIZE       = 9000;

// I set this to just before the first PropertyListed event
// Current block is ~34632409, contract deployed well before that
// Start from block 34500000 to cover all listings without hitting rate limits
const DEPLOY_BLOCK     = 34500000;

export function useRegistry(signer, provider) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(false);

  const getProvider = useCallback(() => {
    return provider || new ethers.JsonRpcProvider(PUBLIC_RPC);
  }, [provider]);

  const getRegistry = useCallback((signerOrProvider) =>
    new ethers.Contract(REGISTRY_ADDRESS, RegistryABI.abi, signerOrProvider), []);

  const getEscrow = useCallback((signerOrProvider) =>
    new ethers.Contract(ESCROW_ADDRESS, EscrowABI.abi, signerOrProvider), []);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const p = getProvider();
      const registry = getRegistry(p);
      const currentBlock = await p.getBlockNumber();

      // I paginate in chunks of 9000 to stay under drpc free tier limit
      let allEvents = [];
      for (let from = DEPLOY_BLOCK; from <= currentBlock; from += CHUNK_SIZE) {
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

      console.log(`Found ${allEvents.length} PropertyListed events`);

      const props = await Promise.all(allEvents.map(async (e) => {
        const tokenId = e.args[0];
        const prop = await registry.getProperty(tokenId);
        return {
          tokenId: tokenId.toString(),
          location: prop.location,
          latitude: prop.latitude,
          longitude: prop.longitude,
          size: prop.size,
          price: prop.price,
          description: prop.description,
          docsHash: prop.docsHash,
          status: Number(prop.status),
          owner: await registry.ownerOf(tokenId),
        };
      }));
      setProperties(props);
    } catch (e) { console.error("fetchProperties error:", e); }
    setLoading(false);
  }, [getProvider, getRegistry]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  return {
    properties, loading, fetchProperties,
    REGISTRY_ADDRESS, ESCROW_ADDRESS,
    getRegistry, getEscrow
  };
}
