import { useState } from "react";
import { ethers } from "ethers";
import { useRegistry } from "../hooks/useRegistry.js";

const inputStyle = {
  width: "100%", padding: "10px 14px",
  border: "1px solid var(--border)", borderRadius: 2,
  background: "var(--warm-white)", fontSize: 13, outline: "none",
};

const labelStyle = {
  display: "block", fontSize: 11,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--mid)", marginBottom: 6,
};

export default function AdminDashboard({ wallet }) {
  const reg = useRegistry(wallet.signer, wallet.provider, wallet.chainId);
  const [listerAddr, setListerAddr]   = useState("");
  const [feeInput, setFeeInput]       = useState("");
  const [feeRecipient, setFeeRecipient] = useState("");
  const [expiryDays, setExpiryDays]   = useState("");
  const [dealId, setDealId]           = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [status, setStatus]           = useState("");
  const [loading, setLoading]         = useState(false);

  function msg(m) { setStatus(m); }

  async function addLister() {
    if (!wallet.signer || !listerAddr) return;
    setLoading(true); msg("Adding verified lister...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const tx = await registry.setVerifiedLister(listerAddr, true);
      await tx.wait();
      msg("Lister added: " + listerAddr);
      setListerAddr("");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  async function removeLister() {
    if (!wallet.signer || !listerAddr) return;
    setLoading(true); msg("Removing lister...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const tx = await registry.setVerifiedLister(listerAddr, false);
      await tx.wait();
      msg("Lister removed: " + listerAddr);
      setListerAddr("");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  async function updateFee() {
    if (!wallet.signer || !feeInput || !feeRecipient) return;
    setLoading(true); msg("Updating platform fee...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const tx = await escrow.setPlatformFee(Number(feeInput) * 100, feeRecipient);
      await tx.wait();
      msg(`Fee updated to ${feeInput}%`);
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  async function updateExpiry() {
    if (!wallet.signer || !expiryDays) return;
    setLoading(true); msg("Updating deal expiry...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const tx = await escrow.setDealExpiry(Number(expiryDays) * 86400);
      await tx.wait();
      msg(`Expiry updated to ${expiryDays} days`);
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  // I release a deal after off-chain verification passes
  async function releaseDeal() {
    if (!wallet.signer || !dealId) return;
    setLoading(true); msg("Releasing deal — transferring ownership...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const tx = await escrow.releaseDeal(BigInt(dealId));
      await tx.wait();
      msg(`Deal #${dealId} released. Ownership transferred to buyer.`);
      setDealId("");
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I reject a deal and refund the buyer if verification fails
  async function rejectDeal() {
    if (!wallet.signer || !dealId) return;
    setLoading(true); msg("Rejecting deal — refunding buyer...");
    try {
      const escrow = reg.getEscrow(wallet.signer);
      const reason = rejectReason.trim() || "Rejected by platform";
      const tx = await escrow.rejectDeal(BigInt(dealId), reason);
      await tx.wait();
      msg(`Deal #${dealId} rejected. Buyer refund queued.`);
      setDealId(""); setRejectReason("");
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function pauseRegistry() {
    if (!wallet.signer) return;
    setLoading(true); msg("Pausing registry...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const tx = await registry.pause();
      await tx.wait();
      msg("Registry paused.");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  async function unpauseRegistry() {
    if (!wallet.signer) return;
    setLoading(true); msg("Unpausing registry...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const tx = await registry.unpause();
      await tx.wait();
      msg("Registry unpaused.");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  const section = (title) => (
    <div style={{
      fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
      color: "var(--gold)", marginBottom: 16, paddingBottom: 10,
      borderBottom: "1px solid var(--border)",
    }}>{title}</div>
  );

  const card = (children) => (
    <div style={{
      background: "var(--warm-white)", border: "1px solid var(--border)",
      borderRadius: 4, padding: 28, marginBottom: 16,
    }}>{children}</div>
  );

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Owner Only
        </p>
        <h1 style={{ fontSize: 48, fontWeight: 300 }}>Admin Dashboard</h1>
      </div>

      {!wallet.address && (
        <div style={{ padding: 24, border: "1px dashed var(--border)", borderRadius: 4, color: "var(--mid)", fontSize: 13 }}>
          Connect wallet to access admin controls
        </div>
      )}

      {wallet.address && (<>

        {/* Verified Listers */}
        {card(<>
          {section("Verified Listers")}
          <label style={labelStyle}>Wallet Address</label>
          <input style={{ ...inputStyle, marginBottom: 12 }}
            placeholder="0x..."
            value={listerAddr} onChange={e => setListerAddr(e.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={addLister} disabled={loading} style={{
              padding: "10px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Add Lister</button>
            <button onClick={removeLister} disabled={loading} style={{
              padding: "10px", border: "1px solid var(--border)",
              background: "transparent", borderRadius: 2,
              fontSize: 12, color: "var(--mid)", letterSpacing: "0.06em", cursor: "pointer",
            }}>Remove Lister</button>
          </div>
        </>)}

        {/* Deal Management */}
        {card(<>
          {section("Deal Management")}
          <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 16, lineHeight: 1.6 }}>
            After verifying off-chain documentation, release a deal to transfer ownership
            to the buyer. Reject to cancel and refund the buyer in full.
          </p>
          <label style={labelStyle}>Deal ID</label>
          <input style={{ ...inputStyle, marginBottom: 12 }}
            placeholder="1"
            type="number" min="1"
            value={dealId} onChange={e => setDealId(e.target.value)} />
          <label style={labelStyle}>Rejection Reason (optional)</label>
          <input style={{ ...inputStyle, marginBottom: 16 }}
            placeholder="Title deed verification failed"
            value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={releaseDeal} disabled={loading || !dealId} style={{
              padding: "10px", border: "none",
              background: "var(--green)", color: "#fff",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Release Deal</button>
            <button onClick={rejectDeal} disabled={loading || !dealId} style={{
              padding: "10px", border: "1px solid var(--red)",
              background: "rgba(139,44,44,0.06)", color: "var(--red)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Reject &amp; Refund</button>
          </div>
        </>)}

        {/* Platform Fee */}
        {card(<>
          {section("Platform Fee")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Fee % (max 10)</label>
              <input style={inputStyle} placeholder="1" type="number" min="0" max="10"
                value={feeInput} onChange={e => setFeeInput(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Fee Recipient</label>
              <input style={inputStyle} placeholder="0x..."
                value={feeRecipient} onChange={e => setFeeRecipient(e.target.value)} />
            </div>
          </div>
          <button onClick={updateFee} disabled={loading} style={{
            padding: "10px 20px", border: "none",
            background: "var(--charcoal)", color: "var(--warm-white)",
            borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
          }}>Update Fee</button>
        </>)}

        {/* Deal Expiry */}
        {card(<>
          {section("Deal Expiry")}
          <label style={labelStyle}>Expiry (days, 1–30)</label>
          <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="7" type="number"
            value={expiryDays} onChange={e => setExpiryDays(e.target.value)} />
          <button onClick={updateExpiry} disabled={loading} style={{
            padding: "10px 20px", border: "none",
            background: "var(--charcoal)", color: "var(--warm-white)",
            borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
          }}>Update Expiry</button>
        </>)}

        {/* Emergency Controls */}
        {card(<>
          {section("Emergency Controls")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={pauseRegistry} disabled={loading} style={{
              padding: "10px", border: "1px solid rgba(139,44,44,0.3)",
              background: "rgba(139,44,44,0.06)", color: "var(--red)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Pause Registry</button>
            <button onClick={unpauseRegistry} disabled={loading} style={{
              padding: "10px", border: "1px solid rgba(45,106,79,0.3)",
              background: "rgba(45,106,79,0.06)", color: "var(--green)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Unpause Registry</button>
          </div>
        </>)}

        {status && (
          <div style={{
            padding: "12px 16px", borderRadius: 2, fontSize: 12,
            background: status.includes("Error") ? "rgba(139,44,44,0.06)" : "rgba(45,106,79,0.06)",
            border: `1px solid ${status.includes("Error") ? "var(--red)" : "var(--green)"}30`,
            color: status.includes("Error") ? "var(--red)" : "var(--green)",
          }}>{status}</div>
        )}

      </>)}
    </div>
  );
}
