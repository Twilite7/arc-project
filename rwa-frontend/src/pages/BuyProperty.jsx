import { useState, useEffect } from "react";
import { ethers } from "ethers";
import StatusBadge from "../components/StatusBadge.jsx";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow.json";

const REGISTRY_ADDRESS = "0xC435b05C568aE2Be474C4E68448f9c7c504f3855";
const ESCROW_ADDRESS   = "0xfc3553E0A744c0B2B0c9953B5cA215689ECB3C60";
const GATEWAY          = "https://gateway.pinata.cloud/ipfs";
const ZERO_ADDR        = "0x0000000000000000000000000000000000000000";

function parseDescription(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      desc: parsed.desc || "",
      imageSrc: parsed.image ? parsed.image.replace("ipfs://", `${GATEWAY}/`) : null,
    };
  } catch {
    return { desc: raw, imageSrc: null };
  }
}

function getRegistry(signerOrProvider) {
  return new ethers.Contract(REGISTRY_ADDRESS, RegistryABI.abi, signerOrProvider);
}
function getEscrow(signerOrProvider) {
  return new ethers.Contract(ESCROW_ADDRESS, EscrowABI.abi, signerOrProvider);
}

export default function BuyProperty({ wallet, tokenId }) {
  const [prop, setProp] = useState(null);
  const [deal, setDeal] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputId, setInputId] = useState(tokenId || "");

  async function loadProperty(id) {
    if (!id) return;
    setStatus("");
    try {
      const provider = wallet.provider;
      if (!provider) { setStatus("Connect your wallet first."); return; }

      const registry = getRegistry(provider);
      const escrow = getEscrow(provider);
      const tokenIdBig = BigInt(id);

      const p = await registry.getProperty(tokenIdBig);
      const owner = await registry.ownerOf(tokenIdBig);

      setProp({
        tokenId: tokenIdBig,
        owner,
        status: Number(p.status),
        location: p.location,
        latitude: p.latitude,
        longitude: p.longitude,
        size: p.size,
        price: p.price,
        description: p.description,
        docsHash: p.docsHash,
      });

      const hasActive = await escrow.hasActiveDeal(tokenIdBig);
      if (hasActive) {
        const d = await escrow.getDealByToken(tokenIdBig);
        setDeal(d);
      } else {
        setDeal(null);
      }
    } catch (e) {
      setStatus("Property not found: " + (e.reason || e.message));
      setProp(null);
      setDeal(null);
    }
  }

  useEffect(() => {
    if (tokenId && wallet.provider) loadProperty(tokenId);
  }, [tokenId, wallet.provider]);

  async function openDeal() {
    if (!wallet.signer || !prop) return;
    setLoading(true); setStatus("Opening escrow deal...");
    try {
      const escrow = getEscrow(wallet.signer);
      const tx = await escrow.openDeal(prop.tokenId);
      await tx.wait();
      setStatus("Deal opened. Now a buyer can deposit.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function cancelDeal() {
    if (!wallet.signer || !prop) return;
    setLoading(true); setStatus("Cancelling deal...");
    try {
      const escrow = getEscrow(wallet.signer);
      const dealId = await escrow.tokenToDeal(prop.tokenId);
      const tx = await escrow.cancelDeal(dealId);
      await tx.wait();
      setStatus("Deal cancelled. Property is available again.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function deposit() {
    if (!wallet.signer || !deal) return;
    setLoading(true); setStatus("Confirm deposit in MetaMask...");
    try {
      const escrow = getEscrow(wallet.signer);
      const dealId = await escrow.tokenToDeal(prop.tokenId);
      const tx = await escrow.deposit(dealId, { value: prop.price });
      await tx.wait();
      setStatus("Deposited. Now sign to finalise the deal.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function sign() {
    if (!wallet.signer || !deal) return;
    setLoading(true); setStatus("Sign the deal in MetaMask...");
    try {
      const escrow = getEscrow(wallet.signer);
      const dealId = await escrow.tokenToDeal(prop.tokenId);
      const dealData = await escrow.getDeal(dealId);
      const buyerMessageHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "address", "address", "uint256"],
        [dealId, prop.tokenId, dealData.seller, wallet.address, prop.price]
      );
      const buyerSig = await wallet.signer.signMessage(ethers.getBytes(buyerMessageHash));
      const tx = await escrow.buyerSign(dealId, buyerSig);
      await tx.wait();
      setStatus("Deal completed! Property transferred to your wallet.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function withdrawFunds() {
    if (!wallet.signer) return;
    setLoading(true); setStatus("Checking pending balance...");
    try {
      const escrow = getEscrow(wallet.signer);
      const pending = await escrow.getPendingWithdrawal(wallet.address);
      if (pending === 0n) { setStatus("No funds to withdraw."); setLoading(false); return; }
      setStatus("Withdrawing funds...");
      const tx = await escrow.withdrawFunds();
      await tx.wait();
      setStatus(`Withdrawn ${ethers.formatEther(pending)} ETH successfully.`);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  const isSeller = prop && wallet.address &&
    prop.owner.toLowerCase() === wallet.address.toLowerCase();

  const isBuyer = deal && wallet.address && deal.buyer &&
    deal.buyer.toLowerCase() === wallet.address.toLowerCase() &&
    deal.buyer.toLowerCase() !== ZERO_ADDR;

  const noBuyerYet = !deal?.buyer || deal.buyer.toLowerCase() === ZERO_ADDR;

  const { desc, imageSrc } = prop
    ? parseDescription(prop.description)
    : { desc: "", imageSrc: null };

  const isError = status.startsWith("Error") ||
    status.startsWith("Property not found") ||
    status.startsWith("Connect");

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Escrow Flow
        </p>
        <h1 style={{ fontSize: 48, fontWeight: 300 }}>Acquire Property</h1>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <input
          style={{
            flex: 1, padding: "10px 14px",
            border: "1px solid var(--border)", borderRadius: 2,
            background: "var(--warm-white)", fontSize: 13, outline: "none",
          }}
          placeholder="Enter Token ID"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
        />
        <button onClick={() => loadProperty(inputId)} style={{
          padding: "10px 20px", border: "none",
          background: "var(--charcoal)", color: "var(--warm-white)",
          borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
        }}>Load</button>
      </div>

      {prop && (
        <div style={{
          background: "var(--warm-white)", border: "1px solid var(--border)",
          borderRadius: 4, overflow: "hidden", marginBottom: 24,
        }}>
          {imageSrc && (
            <img src={imageSrc} alt={prop.location}
              style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
          )}
          <div style={{ padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "var(--mid)" }}>Token #{prop.tokenId.toString()}</span>
              <StatusBadge status={prop.status} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 400, marginBottom: 8 }}>{prop.location}</h2>
            <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 20 }}>{desc}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                ["GPS", `${prop.latitude}, ${prop.longitude}`],
                ["Size", prop.size],
                ["Price", prop.price ? `${ethers.formatEther(prop.price)} ETH` : "..."],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {prop && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Seller: open deal */}
          {isSeller && prop.status === 0 && (
            <button onClick={openDeal} disabled={loading} style={{
              padding: "12px", border: "1px solid var(--charcoal)",
              background: "transparent", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
            }}>Open Escrow Deal</button>
          )}

          {/* Seller: cancel deal — only if no buyer has deposited yet */}
          {isSeller && prop.status === 1 && noBuyerYet && (
            <button onClick={cancelDeal} disabled={loading} style={{
              padding: "12px", border: "1px solid var(--red)",
              background: "transparent", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer", color: "var(--red)",
            }}>Cancel Deal</button>
          )}

          {/* Buyer: deposit */}
          {!isSeller && prop.status === 1 && noBuyerYet && (
            <button onClick={deposit} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
            }}>Deposit {prop.price ? ethers.formatEther(prop.price) : "..."} ETH</button>
          )}

          {/* Buyer: sign */}
          {isBuyer && !deal.buyerSigned && (
            <button onClick={sign} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--gold)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
            }}>Sign & Finalise Deal</button>
          )}

          {/* Seller: withdraw */}
          {isSeller && (
            <button onClick={withdrawFunds} disabled={loading} style={{
              padding: "12px", border: "1px solid var(--border)",
              background: "transparent", borderRadius: 2,
              fontSize: 12, color: "var(--mid)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
            }}>Withdraw Pending Funds</button>
          )}

        </div>
      )}

      {status && (
        <div style={{
          marginTop: 20, padding: "12px 16px", borderRadius: 2, fontSize: 12,
          background: isError ? "rgba(139,44,44,0.06)" : "rgba(45,106,79,0.06)",
          border: `1px solid ${isError ? "var(--red)" : "var(--green)"}30`,
          color: isError ? "var(--red)" : "var(--green)",
        }}>{status}</div>
      )}
    </div>
  );
}
