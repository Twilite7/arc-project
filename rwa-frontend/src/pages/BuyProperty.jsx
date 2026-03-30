import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useRegistry } from "../hooks/useRegistry.js";
import StatusBadge from "../components/StatusBadge.jsx";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

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

export default function BuyProperty({ wallet, tokenId }) {
  const reg = useRegistry(wallet.signer, wallet.provider);
  const [prop, setProp] = useState(null);
  const [deal, setDeal] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputId, setInputId] = useState(tokenId || "");

  async function loadProperty(id) {
    if (!wallet.provider || !id) return;
    setStatus("");
    try {
      const registry = reg.getRegistry(wallet.provider);
      const escrow = reg.getEscrow(wallet.provider);
      const p = await registry.getProperty(id);
      const owner = await registry.ownerOf(id);
      setProp({ ...p, tokenId: id, owner, status: Number(p.status) });

      const hasActive = await escrow.hasActiveDeal(id);
      if (hasActive) {
        const d = await escrow.getDealByToken(id);
        setDeal(d);
      } else {
        setDeal(null);
      }
    } catch (e) {
      setStatus("Property not found.");
      setProp(null);
      setDeal(null);
    }
  }

  useEffect(() => { if (tokenId) loadProperty(tokenId); }, [tokenId, wallet.provider]);

  async function openDeal() {
    if (!wallet.signer || !prop) return;
    setLoading(true); setStatus("Opening escrow deal...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const tx = await escrow.openDeal(prop.tokenId);
      await tx.wait();
      setStatus("Deal opened. Now a buyer can deposit.");
      await loadProperty(prop.tokenId);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function deposit() {
    if (!wallet.signer || !deal) return;
    setLoading(true); setStatus("Confirm deposit in MetaMask...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const dealId = await escrow.tokenToDeal(prop.tokenId);
      const tx = await escrow.deposit(dealId, { value: prop.price });
      await tx.wait();
      setStatus("Deposited. Now sign to finalise the deal.");
      await loadProperty(prop.tokenId);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function sign() {
    if (!wallet.signer || !deal) return;
    setLoading(true); setStatus("Sign the deal in MetaMask...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
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
      await loadProperty(prop.tokenId);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function withdrawFunds() {
    if (!wallet.signer) return;
    setLoading(true); setStatus("Checking pending balance...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
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

  // I check explicitly for zero address — JS falsy check alone isn't reliable here
  const noBuyerYet = !deal?.buyer ||
    deal.buyer.toLowerCase() === ZERO_ADDR;

  const { desc, imageSrc } = prop ? parseDescription(prop.description) : { desc: "", imageSrc: null };

  const isError = status.startsWith("Error") || status === "Property not found.";

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Escrow Flow
        </p>
        <h1 style={{ fontSize: 48, fontWeight: 300 }}>Acquire Property</h1>
      </div>

      {/* Token lookup */}
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

      {/* Property details */}
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
              <span style={{ fontSize: 11, color: "var(--mid)" }}>Token #{prop.tokenId}</span>
              <StatusBadge status={prop.status} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 400, marginBottom: 8 }}>{prop.location}</h2>
            <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 20 }}>{desc}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                ["GPS", `${prop.latitude}, ${prop.longitude}`],
                ["Size", prop.size],
                ["Price", `${ethers.formatEther(prop.price)} ETH`],
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

      {/* Action buttons */}
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

          {/* Buyer: deposit — explicit zero-address check */}
          {!isSeller && prop.status === 1 && deal && noBuyerYet && (
            <button onClick={deposit} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
            }}>Deposit {ethers.formatEther(prop.price)} ETH</button>
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
