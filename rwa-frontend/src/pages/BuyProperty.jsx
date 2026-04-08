import { useState, useEffect } from "react";
import { ethers } from "ethers";
import StatusBadge from "../components/StatusBadge.jsx";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow8183.json";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

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

function getRegistry(p, addr) { return new ethers.Contract(addr, RegistryABI.abi, p); }
function getEscrow(p, addr)   { return new ethers.Contract(addr, EscrowABI.abi, p); }
function getUSDC(p, addr)     { return new ethers.Contract(addr, ERC20_ABI, p); }

export default function BuyProperty({ wallet, tokenId }) {
  const net = wallet.network;

  async function checkNetwork() {
    if (!net) {
      setStatus("Error: Unsupported network. Switch to Arc Testnet.");
      return false;
    }
    return true;
  }

  const [prop, setProp]         = useState(null);
  const [deal, setDeal]         = useState(null);
  const [usdcBalance, setBalance] = useState(null);
  const [status, setStatus]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [inputId, setInputId]   = useState(tokenId || "");

  async function loadProperty(id) {
    if (!id) return;
    setStatus("");
    try {
      const provider = wallet.provider;
      if (!provider) { setStatus("Connect your wallet first."); return; }
      if (!net) { setStatus("Unsupported network. Switch to Arc Testnet."); return; }

      const registry = getRegistry(provider, net.registry);
      const escrow   = getEscrow(provider, net.escrow);
      const tid      = BigInt(id);

      const [p, owner] = await Promise.all([
        registry.getProperty(tid),
        registry.ownerOf(tid),
      ]);

      setProp({
        tokenId: tid, owner,
        status:      Number(p.status),
        location:    p.location,
        latitude:    p.latitude,
        longitude:   p.longitude,
        size:        p.size,
        price:       p.price,
        description: p.description,
        docsHash:    p.docsHash,
      });

      // I check if there is an active deal for this token
      try {
        const active = await escrow.activeDeal(tid);
        if (active) {
          const jobId = await escrow.tokenToJob(tid);
          const buyer = await escrow.tokenToBuyer(tid);
          setDeal({ active, jobId, buyer });
        } else {
          setDeal(null);
        }
        setRejectionReason("");
      } catch { setDeal(null); setRejectionReason(""); }

      // I fetch rejection reason from DealRejected event if property was rejected
      // Status 0 after a rejection means it was reset to Available — check events
      try {
        const escrowR = getEscrow(provider, net.escrow);
        const events = await escrowR.queryFilter(
          escrowR.filters.DealRejected(tid)
        );
        if (events.length > 0) {
          const latest = events[events.length - 1];
          setRejectionReason(latest.args.reason || "No reason provided");
        }
      } catch { /* no rejection events is fine */ }

      // I fetch buyer USDC balance
      if (wallet.address) {
        const usdc = getUSDC(provider, net.usdc);
        const bal  = await usdc.balanceOf(wallet.address);
        setBalance(bal);
      }
    } catch (e) {
      setStatus("Property not found: " + (e.reason || e.message));
      setProp(null); setDeal(null);
    }
  }

  useEffect(() => {
    if (tokenId && wallet.provider) loadProperty(tokenId);
  }, [tokenId, wallet.provider]);

  // I let the buyer purchase in one transaction — ERC-8183 handles escrow internally
  async function buyNow() {
    if (!wallet.signer || !prop) return;
    if (!await checkNetwork()) return;
    setLoading(true);
    setStatus("Step 1/2 — Approve USDC in MetaMask...");
    try {
      // I approve the escrow to pull USDC first
      const usdc    = new ethers.Contract(net.usdc, [
        "function approve(address spender, uint256 amount) returns (bool)"
      ], wallet.signer);
      const approveTx = await usdc.approve(net.escrow, prop.price);
      await approveTx.wait();
      setStatus("Step 2/2 — Confirm purchase in MetaMask...");

      const tx = await getEscrow(wallet.signer, net.escrow).buyNow(prop.tokenId);
      await tx.wait();
      setStatus("Purchase complete. Awaiting platform verification to finalise ownership transfer.");
      await new Promise(r => setTimeout(r, 2000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I let the seller submit the deliverable to ERC-8183 to signal readiness
  async function submitDeliverable() {
    if (!wallet.signer || !prop) return;
    if (!await checkNetwork()) return;
    setLoading(true); setStatus("Submitting deliverable in MetaMask...");
    try {
      const tx = await getEscrow(wallet.signer, net.escrow).submitDeliverable(prop.tokenId);
      await tx.wait();
      setStatus("Deliverable submitted. Awaiting admin to release the deal.");
      await new Promise(r => setTimeout(r, 2000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  const isSeller = prop && wallet.address &&
    prop.owner.toLowerCase() === wallet.address.toLowerCase();

  const hasSufficientBalance = usdcBalance !== null && prop !== null &&
    usdcBalance >= prop.price;

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

      {/* Property card */}
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
                ["GPS",   `${prop.latitude}, ${prop.longitude}`],
                ["Size",  prop.size],
                ["Price", prop.price ? `${ethers.formatUnits(prop.price, 6)} USDC` : "..."],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* USDC balance for buyers */}
            {!isSeller && wallet.address && usdcBalance !== null && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "var(--cream)", borderRadius: 2,
                fontSize: 12, color: "var(--mid)",
              }}>
                Your USDC balance:{" "}
                <strong style={{ color: hasSufficientBalance ? "var(--green)" : "var(--red)" }}>
                  {ethers.formatUnits(usdcBalance, 6)} USDC
                </strong>
                {!hasSufficientBalance && (
                  <span style={{ color: "var(--red)", marginLeft: 8 }}>— insufficient</span>
                )}
              </div>
            )}

            {/* Rejection notice */}
            {rejectionReason && prop.status === 0 && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "rgba(139,44,44,0.06)",
                border: "1px solid rgba(139,44,44,0.3)",
                borderRadius: 2, fontSize: 12, color: "var(--red)",
              }}>
                <strong>Last deal rejected</strong> — {rejectionReason}
              </div>
            )}

            {/* In escrow notice */}
            {prop.status === 1 && deal && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "rgba(184,151,42,0.06)",
                border: "1px solid rgba(184,151,42,0.3)",
                borderRadius: 2, fontSize: 12, color: "var(--gold)",
              }}>
                This property is in escrow. Awaiting platform verification to release ownership.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {prop && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Seller: submit deliverable once property is in escrow */}
          {isSeller && prop.status === 1 && deal && deal.active && (
            <button onClick={submitDeliverable} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Processing..." : "Confirm Transfer — Submit Deliverable"}
            </button>
          )}

          {/* Buyer: single-step buy now */}
          {!isSeller && prop.status === 0 && (
            <button onClick={buyNow} disabled={loading || !hasSufficientBalance} style={{
              padding: "12px", border: "none",
              background: hasSufficientBalance ? "var(--gold)" : "var(--border)",
              color: "var(--warm-white)", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: hasSufficientBalance ? "pointer" : "not-allowed",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading
                ? status.startsWith("Step") ? status : "Processing..."
                : `Buy Now · ${prop.price ? ethers.formatUnits(prop.price, 6) : "..."} USDC`}
            </button>
          )}

        </div>
      )}

      {status && !loading && (
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
