import { useState } from "react";
import { ethers } from "ethers";
import { useRegistry } from "../hooks/useRegistry.js";

// I define ERC-8004 ValidationRegistry for admin verification responses
const ERC8004_VALIDATION_ABI = [
  "function validationResponse(bytes32,uint8,string,bytes32,string) external",
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,uint8,string,uint256)",
];

// I define only the ERC-8183 functions the admin calls directly as evaluator
const ERC8183_ABI = [
  "function complete(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function jobs(uint256) view returns (uint256,address,address,address,string,uint256,uint256,uint8,address,bytes32)",
];

const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

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
  const net = wallet.network;

  const [listerAddr, setListerAddr]     = useState("");
  const [tokenId, setTokenId]           = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [jobInfo, setJobInfo]           = useState(null);
  const [status, setStatus]             = useState("");
  const [loading, setLoading]           = useState(false);
  const [listingFeeInput, setListingFeeInput]         = useState("");
  const [verificationFeeInput, setVerificationFeeInput] = useState("");
  const [feeRecipientInput, setFeeRecipientInput]     = useState("");
  const [verifyTokenId, setVerifyTokenId]             = useState("");
  const [verifyInfo, setVerifyInfo]                   = useState(null);

  function msg(m) { setStatus(m); }

  function getERC8183(signer) {
    return new ethers.Contract(net.erc8183, ERC8183_ABI, signer);
  }

  // I load ERC-8183 job info for a given token so admin can see current state
  // I set platform fees on the registry
  async function updateFees() {
    if (!wallet.signer || !net) return;
    setLoading(true); msg("Updating platform fees...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const lFee = listingFeeInput ? ethers.parseUnits(listingFeeInput, 6) : 0n;
      const vFee = verificationFeeInput ? ethers.parseUnits(verificationFeeInput, 6) : 0n;
      const recipient = feeRecipientInput.trim() || ethers.ZeroAddress;
      const tx = await registry.setFees(lFee, vFee, recipient);
      await tx.wait();
      msg(`Fees updated — Listing: ${listingFeeInput || 0} USDC, Verification: ${verificationFeeInput || 0} USDC`);
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I verify a property after reviewing off-chain documents
  async function verifyProperty() {
    if (!wallet.signer || !verifyTokenId) return;
    setLoading(true); msg("Verifying property...");
    try {
      const registry = reg.getRegistry(wallet.signer);
      const tx = await registry.verifyProperty(BigInt(verifyTokenId));
      await tx.wait();
      msg(`Token #${verifyTokenId} verified.`);
      setVerifyTokenId("");
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I load ERC-8004 verification request info for a token
  async function loadVerifyInfo() {
    if (!verifyTokenId || !wallet.provider || !net) return;
    try {
      const registry = reg.getRegistry(wallet.provider);
      const requestHash = await registry.validationRequestHashes(BigInt(verifyTokenId));
      if (requestHash === ethers.ZeroHash) {
        setVerifyInfo(null);
        msg("No verification request for token #" + verifyTokenId);
        return;
      }
      const validation = new ethers.Contract(net.erc8004Validation, ERC8004_VALIDATION_ABI, wallet.provider);
      try {
        const result = await validation.getValidationStatus(requestHash);
        setVerifyInfo({
          requestHash,
          validator: result[0],
          agentId:   result[1].toString(),
          score:     Number(result[2]),
          tags:      result[4],
        });
        msg("");
      } catch {
        // I handle case where request exists but no response yet
        setVerifyInfo({ requestHash, score: -1, tags: "Pending response" });
        msg("");
      }
    } catch (e) { msg("Error: " + (e.reason || e.message)); setVerifyInfo(null); }
  }

  // I approve or reject a property verification via ERC-8004
  async function respondVerification(approve) {
    if (!wallet.signer || !verifyInfo) return;
    setLoading(true);
    msg(approve ? "Approving verification..." : "Rejecting verification...");
    try {
      const validation = new ethers.Contract(net.erc8004Validation, ERC8004_VALIDATION_ABI, wallet.signer);
      const score = approve ? 100 : 0;
      const tags  = approve ? "property_verified" : "rejected";
      await (await validation.validationResponse(
        verifyInfo.requestHash, score, "", ethers.ZeroHash, tags
      )).wait();
      msg(approve ? `Token #${verifyTokenId} verified.` : `Token #${verifyTokenId} rejected.`);
      setVerifyTokenId(""); setVerifyInfo(null);
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function loadDealInfo() {
    if (!tokenId || !wallet.provider || !net) return;
    try {
      const escrow  = reg.getEscrow(wallet.provider);
      const active  = await escrow.activeDeal(BigInt(tokenId));
      if (!active) { setJobInfo(null); msg("No active deal for token #" + tokenId); return; }

      const jobId   = await escrow.tokenToJob(BigInt(tokenId));
      const buyer   = await escrow.tokenToBuyer(BigInt(tokenId));
      const price   = await escrow.tokenToPrice(BigInt(tokenId));
      const erc8183 = new ethers.Contract(net.erc8183, ERC8183_ABI, wallet.provider);
      const job     = await erc8183.jobs(jobId);

      setJobInfo({
        jobId: jobId.toString(),
        buyer,
        price: ethers.formatUnits(price, 6),
        jobStatus: Number(job[7]),
        expiredAt: Number(job[6]),
      });
      msg("");
    } catch (e) { msg("Error: " + (e.reason || e.message)); setJobInfo(null); }
  }

  async function addLister() {
    if (!wallet.signer || !listerAddr) return;
    setLoading(true); msg("Adding verified lister...");
    try {
      const tx = await reg.getRegistry(wallet.signer).setVerifiedLister(listerAddr, true);
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
      const tx = await reg.getRegistry(wallet.signer).setVerifiedLister(listerAddr, false);
      await tx.wait();
      msg("Lister removed: " + listerAddr);
      setListerAddr("");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  // I release a deal:
  //   Step 1 — admin calls complete() on ERC-8183 as evaluator
  //   Step 2 — admin calls releaseDeal() on escrow (verifies job is Completed)
  async function releaseDeal() {
    if (!wallet.signer || !tokenId || !jobInfo) return;
    setLoading(true);
    try {
      const erc8183 = getERC8183(wallet.signer);
      const escrow  = reg.getEscrow(wallet.signer);

      msg("Step 1/2 — Completing ERC-8183 job...");
      const reason = ethers.keccak256(ethers.toUtf8Bytes("property-transfer-approved"));
      await (await erc8183.complete(BigInt(jobInfo.jobId), reason, "0x")).wait();

      msg("Step 2/2 — Releasing deal and transferring NFT...");
      await (await escrow.releaseDeal(BigInt(tokenId))).wait();

      msg(`Deal #${tokenId} released. Ownership transferred to buyer.`);
      setTokenId(""); setJobInfo(null);
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // I reject a deal:
  //   Step 1 — admin calls reject() on ERC-8183 as evaluator
  //   Step 2 — admin calls rejectDeal() on escrow (verifies job is Rejected, refunds buyer)
  async function rejectDeal() {
    if (!wallet.signer || !tokenId || !jobInfo) return;
    setLoading(true);
    try {
      const erc8183 = getERC8183(wallet.signer);
      const escrow  = reg.getEscrow(wallet.signer);
      const reason  = rejectReason.trim() || "Rejected by platform";

      // I only call ERC-8183 reject if the job has been funded (status >= 1)
      // If job is still Open (0), USDC is still in escrow — skip ERC-8183 reject
      if (jobInfo.jobStatus >= 1) {
        msg("Step 1/2 — Rejecting ERC-8183 job...");
        await (await erc8183.reject(BigInt(jobInfo.jobId), ethers.keccak256(ethers.toUtf8Bytes(reason)), "0x")).wait();
        msg("Step 2/2 — Refunding buyer...");
      } else {
        msg("Refunding buyer...");
      }

      await (await escrow.rejectDeal(BigInt(tokenId), reason)).wait();

      msg(`Deal #${tokenId} rejected. Buyer refunded.`);
      setTokenId(""); setRejectReason(""); setJobInfo(null);
    } catch (e) { msg("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  async function pauseRegistry() {
    if (!wallet.signer) return;
    setLoading(true); msg("Pausing registry...");
    try {
      await (await reg.getRegistry(wallet.signer).pause()).wait();
      msg("Registry paused.");
    } catch (e) { msg("Error: " + e.message); }
    setLoading(false);
  }

  async function unpauseRegistry() {
    if (!wallet.signer) return;
    setLoading(true); msg("Unpausing registry...");
    try {
      await (await reg.getRegistry(wallet.signer).unpause()).wait();
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

  const canRelease = jobInfo && jobInfo.jobStatus === 2; // Submitted
  const canReject  = jobInfo && (jobInfo.jobStatus === 0 || jobInfo.jobStatus === 1 || jobInfo.jobStatus === 2); // Open, Funded, or Submitted

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
            Enter a token ID to load the active deal. Release after the seller has submitted the deliverable. the deliverable. the deliverable.
            the deliverable on ERC-8183. Reject at any point to refund the buyer.
          </p>

          <label style={labelStyle}>Token ID</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input style={{ ...inputStyle, marginBottom: 0 }}
              placeholder="1"
              type="number" min="1"
              value={tokenId} onChange={e => { setTokenId(e.target.value); setJobInfo(null); }} />
            <button onClick={loadDealInfo} disabled={loading || !tokenId} style={{
              padding: "10px 16px", border: "none", whiteSpace: "nowrap",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Load</button>
          </div>

          {/* I show ERC-8183 job info once loaded */}
          {jobInfo && (
            <div style={{
              marginBottom: 16, padding: "12px 14px",
              background: "var(--cream)", borderRadius: 2, fontSize: 12,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["ERC-8183 Job", "#" + jobInfo.jobId],
                  ["Job Status", JOB_STATUS[jobInfo.jobStatus] ?? jobInfo.jobStatus],
                  ["Buyer", jobInfo.buyer.slice(0, 6) + "..." + jobInfo.buyer.slice(-4)],
                  ["Locked", jobInfo.price + " USDC"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{k}</div>
                    <div style={{ fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label style={labelStyle}>Rejection Reason</label>
          <input style={{ ...inputStyle, marginBottom: 16 }}
            placeholder="Title deed verification failed"
            value={rejectReason} onChange={e => setRejectReason(e.target.value)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={releaseDeal} disabled={loading || !canRelease} style={{
              padding: "10px", border: "none",
              background: canRelease ? "var(--green)" : "var(--border)",
              color: canRelease ? "#fff" : "var(--mid)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em",
              cursor: canRelease ? "pointer" : "not-allowed",
            }}>
              {loading ? "Processing..." : "Release Deal"}
            </button>
            <button onClick={rejectDeal} disabled={loading || !canReject} style={{
              padding: "10px",
              border: canReject ? "1px solid var(--red)" : "1px solid var(--border)",
              background: canReject ? "rgba(139,44,44,0.06)" : "transparent",
              color: canReject ? "var(--red)" : "var(--mid)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em",
              cursor: canReject ? "pointer" : "not-allowed",
            }}>Reject &amp; Refund</button>
          </div>

          {/* I explain why buttons are disabled */}
          {jobInfo && !canRelease && jobInfo.jobStatus !== 4 && (
            <p style={{ marginTop: 10, fontSize: 11, color: "var(--mid)" }}>
              {jobInfo.jobStatus === 0 && "Job created — funding in progress."}
              {jobInfo.jobStatus === 1 && "Waiting for seller to submit the deliverable."}
              {jobInfo.jobStatus === 2 && ""}
            </p>
          )}
        </>)}

        {/* Platform Fees */}
        {card(<>
          {section("Platform Fees")}
          <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 16, lineHeight: 1.6 }}>
            Set listing and verification fees in USDC. Leave at 0 to disable.
            Max 500 USDC per fee. Fee recipient must be set if either fee is non-zero.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Listing Fee (USDC)</label>
              <input style={inputStyle} placeholder="0" type="number" min="0" max="500" step="0.01"
                value={listingFeeInput} onChange={e => setListingFeeInput(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Verification Fee (USDC)</label>
              <input style={inputStyle} placeholder="0" type="number" min="0" max="500" step="0.01"
                value={verificationFeeInput} onChange={e => setVerificationFeeInput(e.target.value)} />
            </div>
          </div>
          <label style={labelStyle}>Fee Recipient</label>
          <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="0x..."
            value={feeRecipientInput} onChange={e => setFeeRecipientInput(e.target.value)} />
          <button onClick={updateFees} disabled={loading} style={{
            padding: "10px 20px", border: "none",
            background: "var(--charcoal)", color: "var(--warm-white)",
            borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
          }}>Update Fees</button>
        </>)}

        {/* Property Verification — ERC-8004 */}
        {card(<>
          {section("Property Verification (ERC-8004)")}
          <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 16, lineHeight: 1.6 }}>
            Load a token to see its verification request, then approve or reject via ERC-8004.
          </p>
          <label style={labelStyle}>Token ID</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input style={{ ...inputStyle, marginBottom: 0 }} placeholder="1" type="number" min="1"
              value={verifyTokenId} onChange={e => { setVerifyTokenId(e.target.value); setVerifyInfo(null); }} />
            <button onClick={loadVerifyInfo} disabled={loading || !verifyTokenId} style={{
              padding: "10px 16px", border: "none", whiteSpace: "nowrap",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
            }}>Load</button>
          </div>

          {verifyInfo && (
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--cream)", borderRadius: 2, fontSize: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["Agent ID", verifyInfo.agentId || "—"],
                  ["Current Status", verifyInfo.score === -1 ? "Pending" : verifyInfo.score > 0 ? "Verified" : "Rejected"],
                  ["Tags", verifyInfo.tags || "—"],
                  ["Request Hash", verifyInfo.requestHash?.slice(0,10) + "..."],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{k}</div>
                    <div style={{ fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={() => respondVerification(true)}
              disabled={loading || !verifyInfo || verifyInfo.score > 0} style={{
              padding: "10px", border: "none",
              background: verifyInfo && verifyInfo.score <= 0 ? "var(--green)" : "var(--border)",
              color: verifyInfo && verifyInfo.score <= 0 ? "#fff" : "var(--mid)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em",
              cursor: verifyInfo && verifyInfo.score <= 0 ? "pointer" : "not-allowed",
            }}>Approve</button>
            <button onClick={() => respondVerification(false)}
              disabled={loading || !verifyInfo} style={{
              padding: "10px",
              border: verifyInfo ? "1px solid var(--red)" : "1px solid var(--border)",
              background: verifyInfo ? "rgba(139,44,44,0.06)" : "transparent",
              color: verifyInfo ? "var(--red)" : "var(--mid)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.06em",
              cursor: verifyInfo ? "pointer" : "not-allowed",
            }}>Reject</button>
          </div>
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
