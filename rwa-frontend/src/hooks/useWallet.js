import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";

const ARC_CHAIN_ID = 5042002;

export function useWallet() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

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
      if (Number(network.chainId) !== ARC_CHAIN_ID) {
        setError("Switch to Arc Testnet (Chain ID 5042002).");
        return;
      }
      const _signer = await _provider.getSigner();
      const _address = await _signer.getAddress();
      setProvider(_provider);
      setSigner(_signer);
      setAddress(_address);
      setError("");
    } catch (e) { setError(e.message); }
  }, []);

  return { provider, signer, address, error, connect };
}
