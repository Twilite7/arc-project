import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import { getNetwork, SUPPORTED_CHAIN_IDS } from "../config/networks.js";

export function useWallet() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner]     = useState(null);
  const [address, setAddress]   = useState("");
  const [chainId, setChainId]   = useState(null);
  const [error, setError]       = useState("");

  // I reload on network switch so state never goes stale
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = () => window.location.reload();
    window.ethereum.on("chainChanged", handler);
    return () => window.ethereum.removeListener("chainChanged", handler);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) { setError("MetaMask not found."); return; }
    try {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      await _provider.send("eth_requestAccounts", []);
      const network = await _provider.getNetwork();
      const _chainId = Number(network.chainId);

      if (!SUPPORTED_CHAIN_IDS.includes(_chainId)) {
        setError(`Unsupported network. Switch to Arc Testnet (5042002) or Robinhood Testnet (46630).`);
        return;
      }

      const _signer  = await _provider.getSigner();
      const _address = await _signer.getAddress();

      setProvider(_provider);
      setSigner(_signer);
      setAddress(_address);
      setChainId(_chainId);
      setError("");
    } catch (e) { setError(e.message); }
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAddress("");
    setChainId(null);
    setError("");
  }, []);

  // I expose the active network config so pages don't need to re-derive it
  const network = getNetwork(chainId);

  return { provider, signer, address, chainId, network, error, connect, disconnect };
}
