import { useState, useEffect } from "react";
import { ethers } from "ethers";
import StatusBadge from "../components/StatusBadge.jsx";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow.json";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
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
function getXUSD(p, addr)     { return new ethers.Contract(addr, ERC20_ABI, p); }

export default function BuyProperty({ wallet, tokenId }) {
  // I verify the user is on Arc Testnet before any transaction
  // I derive network config from the connected wallet
  const net = wallet.network;

  async function checkNetwork() {
    if (!net) {
      setStatus("Error: Unsupported network. Switch to Arc or Robinhood Testnet.");
      return false;
    }
    return true;
  }
  const [prop, setProp]             = useState(null);
  const [deal, setDeal]             = useState(null);
  const [xusdBalance, setBalance]   = useState(null);
  const [xusdAllowance, setAllowance] = useState(null);
  const [status, setStatus]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [inputId, setInputId]       = useState(tokenId || "");

  async function loadProperty(id) {
    if (!id) return;
    setStatus("");
    try {
      const provider = wallet.provider;
      if (!provider) { setStatus("Connect your wallet first."); return; }

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

      try {
        const d = await escrow.getDealByToken(tid);
        setDeal(d);
        // I fetch rejection reason from event log if deal was cancelled
        if (Number(d.status) === 2) {
          try {
            const dealId = await escrow.tokenToDeal(tid);
            const filter = escrow.filters.DealRejected(dealId);
            const logs = await provider.getLogs({
              address: net.escrow,
              topics: filter.topics,
              fromBlock: 0,
              toBlock: "latest",
            });
            if (logs.length > 0) {
              const parsed = escrow.interface.parseLog(logs[0]);
              setRejectionReason(parsed.args[1] || "No reason provided");
            }
          } catch { setRejectionReason("Deal was rejected by platform."); }
        } else {
          setRejectionReason("");
        }
      } catch { setDeal(null); setRejectionReason(""); }

      if (wallet.address) {
        const xusd = getXUSD(provider, net.xusd);
        const [bal, allow] = await Promise.all([
          xusd.balanceOf(wallet.address),
          xusd.allowance(wallet.address, net.escrow),
        ]);
        setBalance(bal);
        setAllowance(allow);
      }
    } catch (e) {
      setStatus("Property not found: " + (e.reason || e.message));
      setProp(null); setDeal(null);
    }
  }

  useEffect(() => {
    if (tokenId && wallet.provider) loadProperty(tokenId);
  }, [tokenId, wallet.provider]);

  // ── Step 1: Approve XUSD ──────────────────────────────────────
  async function approveXUSD() {
    if (!wallet.signer || !prop) return;
    if (!await checkNetwork()) return;
    setLoading(true); setStatus("Approving XUSD in MetaMask...");
    try {
      const tx = await getXUSD(wallet.signer, net.xusd).approve(net.escrow, prop.price);
      await tx.wait();
      setStatus("Approved. Now click Buy Now.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ── Step 2: Buy Now — locks XUSD in escrow ────────────────────
  async function buyNow() {
    if (!wallet.signer || !prop) return;
    if (!await checkNetwork()) return;
    setLoading(true); setStatus("Submitting purchase in MetaMask...");
    try {
      const tx = await getEscrow(wallet.signer, net.escrow).buyNow(prop.tokenId);
      await tx.wait();
      setStatus("Purchase complete. Awaiting platform verification to finalise ownership transfer.");
      await new Promise(r => setTimeout(r, 2000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ── Seller: withdraw XUSD after deal is released ──────────────
  async function withdrawFunds() {
    if (!wallet.signer) return;
    if (!await checkNetwork()) return;
    setLoading(true); setStatus("Checking pending balance...");
    try {
      const escrow  = getEscrow(wallet.signer, net.escrow);
      const pending = await escrow.getPendingWithdrawal(wallet.address);
      if (pending === 0n) { setStatus("No funds to withdraw."); setLoading(false); return; }
      const tx = await escrow.withdrawFunds();
      await tx.wait();
      setStatus(`Withdrawn ${ethers.formatUnits(pending, 6)} XUSD successfully.`);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I check deal.seller after transfer since prop.owner changes to buyer on release
  // I allow buyer to revoke stale allowance if a deal fails before buyNow
  async function revokeAllowance() {
    setLoading(true); setStatus("Revoking XUSD approval...");
    try {
      const tx = await getXUSD(wallet.signer, net.xusd).approve(net.escrow, 0n);
      await tx.wait();
      setStatus("Allowance revoked.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  const isSeller = prop && wallet.address &&
    (deal ? deal.seller : prop.owner).toLowerCase() === wallet.address.toLowerCase();

  const hasAllowance = xusdAllowance !== null && prop !== null &&
    xusdAllowance >= prop.price;

  const hasSufficientBalance = xusdBalance !== null && prop !== null &&
    xusdBalance >= prop.price;

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
                ["GPS", `${prop.latitude}, ${prop.longitude}`],
                ["Size", prop.size],
                ["Price", prop.price ? `${ethers.formatUnits(prop.price, 6)} XUSD` : "..."],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* XUSD balance for buyers */}
            {!isSeller && wallet.address && xusdBalance !== null && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "var(--cream)", borderRadius: 2,
                fontSize: 12, color: "var(--mid)",
              }}>
                Your XUSD balance:{" "}
                <strong style={{ color: hasSufficientBalance ? "var(--green)" : "var(--red)" }}>
                  {ethers.formatUnits(xusdBalance, 6)} XUSD
                </strong>
                {!hasSufficientBalance && (
                  <span style={{ color: "var(--red)", marginLeft: 8 }}>— insufficient</span>
                )}
              </div>
            )}

            {/* Rejection notice */}
            {deal && Number(deal.status) === 2 && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "rgba(139,44,44,0.06)",
                border: "1px solid rgba(139,44,44,0.3)",
                borderRadius: 2, fontSize: 12, color: "var(--red)",
              }}>
                <strong>Deal Rejected</strong>
                {rejectionReason && <span> — {rejectionReason}</span>}
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

          {/* Buyer: approve XUSD */}
          {!isSeller && prop.status === 0 && hasSufficientBalance && !hasAllowance && (
            <button onClick={approveXUSD} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>
              Step 1 — Approve {prop.price ? ethers.formatUnits(prop.price, 6) : "..."} XUSD
            </button>
          )}

          {/* Buyer: revoke stale allowance if deal failed before buyNow */}
          {!isSeller && prop.status === 0 && hasAllowance && !loading && (
            <button onClick={revokeAllowance} disabled={loading} style={{
              padding: "10px", border: "1px solid rgba(139,44,44,0.3)",
              background: "rgba(139,44,44,0.06)", color: "var(--red)",
              borderRadius: 2, fontSize: 11, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>Revoke Approval</button>
          )}

          {/* Buyer: buy now */}
          {!isSeller && prop.status === 0 && hasAllowance && (
            <button onClick={buyNow} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--gold)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>
              {loading ? "Processing..." : `Step 2 — Buy Now · ${prop.price ? ethers.formatUnits(prop.price, 6) : "..."} XUSD`}
            </button>
          )}

          {/* Seller: withdraw after release */}
          {isSeller && (
            <button onClick={withdrawFunds} disabled={loading} style={{
              padding: "12px", border: "1px solid var(--border)",
              background: "transparent", borderRadius: 2,
              fontSize: 12, color: "var(--mid)", letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>Withdraw Pending XUSD</button>
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
