import { useState, useEffect } from "react";
import { ethers } from "ethers";
import StatusBadge from "../components/StatusBadge.jsx";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow8183.json";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

// I define only the ERC-8183 functions the seller calls directly
const ERC8183_ABI = [
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams) external",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams) external",
  "function jobs(uint256) view returns (uint256,address,address,address,string,uint256,uint256,uint8,address,bytes32)",
];

// I map ERC-8183 job status codes to labels
const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

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
function getERC8183(p, addr)  { return new ethers.Contract(addr, ERC8183_ABI, p); }
function getUSDC(p, addr)     { return new ethers.Contract(addr, ERC20_ABI, p); }

export default function BuyProperty({ wallet, tokenId }) {
  const net = wallet.network;

  const [prop, setProp]             = useState(null);
  const [deal, setDeal]             = useState(null);
  const [jobStatus, setJobStatus]   = useState(null);
  const [isVerified, setIsVerified] = useState(false);
  const [usdcBalance, setBalance]   = useState(null);
  const [status, setStatus]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [agentIdInput, setAgentIdInput] = useState("");
  const [docsURIInput, setDocsURIInput] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [inputId, setInputId]       = useState(tokenId || "");

  function checkNetwork() {
    if (!net) { setStatus("Error: Unsupported network. Switch to Arc Testnet."); return false; }
    return true;
  }

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

      // I check ERC-8004 verification status
      try {
        const verified = await registry.isVerified(tid);
        setIsVerified(verified);
      } catch { setIsVerified(false); }

      // I load active deal state and ERC-8183 job status
      try {
        const active = await escrow.activeDeal(tid);
        if (active) {
          const jobId    = await escrow.tokenToJob(tid);
          const buyer    = await escrow.tokenToBuyer(tid);
          const isFunded = await escrow.jobFunded(tid);
          setDeal({ active, jobId, buyer, isFunded });

          // I read ERC-8183 job status for display
          const erc8183 = getERC8183(provider, net.erc8183);
          const job = await erc8183.jobs(jobId);
          setJobStatus(Number(job[7]));
        } else {
          setDeal(null);
          setJobStatus(null);
        }
        setRejectionReason("");
      } catch { setDeal(null); setJobStatus(null); setRejectionReason(""); }

      // I check for rejection reason from past events
      try {
        const events = await escrow.queryFilter(escrow.filters.DealRejected(tid));
        if (events.length > 0) {
          const latest = events[events.length - 1];
          setRejectionReason(latest.args.reason || "No reason provided");
        }
      } catch {}

      if (wallet.address) {
        const bal = await getUSDC(provider, net.usdc).balanceOf(wallet.address);
        setBalance(bal);
      }
    } catch (e) {
      setStatus("Property not found: " + (e.reason || e.message));
      setProp(null); setDeal(null); setJobStatus(null);
    }
  }

  useEffect(() => {
    if (tokenId && wallet.provider) loadProperty(tokenId);
  }, [tokenId, wallet.provider]);

  // ─── Buyer ────────────────────────────────────────────────────
  async function buyNow() {
    if (!wallet.signer || !prop || !checkNetwork()) return;
    setLoading(true);
    setStatus("Step 1/2 — Approve USDC...");
    try {
      await (await getUSDC(wallet.signer, net.usdc).approve(net.escrow, prop.price)).wait();
      setStatus("Step 2/2 — Confirm purchase...");
      await (await getEscrow(wallet.signer, net.escrow).buyNow(prop.tokenId)).wait();
      setStatus("Purchase complete. The seller must now set the budget and submit the deliverable on ERC-8183.");
      await new Promise(r => setTimeout(r, 2000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ─── Seller: Request ERC-8004 verification (two steps) ──────────
  // Step 1: seller calls validationRequest directly on ERC-8004 as agent owner
  // Step 2: seller calls recordValidationRequest on our registry to store the hash
  async function requestVerification() {
    if (!wallet.signer || !prop || !checkNetwork()) return;
    if (!agentIdInput) { setStatus("Enter your ERC-8004 Agent ID first."); return; }
    if (!docsURIInput) { setStatus("Enter your documents IPFS URI first."); return; }
    setLoading(true);
    try {
      const erc8004Validation = new ethers.Contract(net.erc8004Validation, [
        "function validationRequest(address,uint256,string,bytes32) external",
      ], wallet.signer);
      const registryRead  = getRegistry(wallet.provider, net.registry);
      const registryWrite = getRegistry(wallet.signer, net.registry);
      const platformAdmin = await registryRead.owner();
      // I compute hash from the immutable on-chain docsHash, not the mutable URI
      // This matches the formula enforced by recordValidationRequest in the registry
      const requestHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "bytes32"],
        [prop.tokenId, wallet.address, prop.docsHash]
      );

      setStatus("Step 1/3 — Submit to ERC-8004...");
      await (await erc8004Validation.validationRequest(
        platformAdmin, BigInt(agentIdInput), docsURIInput, requestHash
      )).wait();

      const fee = await registryRead.verificationFee();
      if (fee > 0n) {
        const usdc = getUSDC(wallet.signer, net.usdc);
        const allowance = await usdc.allowance(wallet.address, net.registry);
        if (allowance < fee) {
          setStatus("Step 2/3 — Approve verification fee...");
          await (await usdc.approve(net.registry, fee)).wait();
        }
      }

      setStatus("Step 3/3 — Record on registry...");
      await (await registryWrite.recordValidationRequest(
        prop.tokenId, BigInt(agentIdInput), requestHash
      )).wait();

      setStatus("Verification requested. Awaiting admin review.");
      await new Promise(r => setTimeout(r, 4000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

    // ─── Seller: Step 1 — setBudget + fundJob combined ──────────────
  // I combine both into one sequential flow so seller signs two txns back to back
  async function setBudgetAndFund() {
    if (!wallet.signer || !prop || !deal || !checkNetwork()) return;
    setLoading(true);
    try {
      const erc8183 = getERC8183(wallet.signer, net.erc8183);
      const escrow  = getEscrow(wallet.signer, net.escrow);

      setStatus("Step 1/2 — Set budget on ERC-8183...");
      await (await erc8183.setBudget(deal.jobId, prop.price, "0x")).wait();

      setStatus("Step 2/2 — Fund escrow job...");
      await (await escrow.fundJob(prop.tokenId)).wait();

      setStatus("Budget set and job funded. Now submit the deliverable.");
      await new Promise(r => setTimeout(r, 4000));
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ─── Seller: Step 2 — submit directly on ERC-8183 ────────────
  async function submitDeliverable() {
    if (!wallet.signer || !prop || !deal || !checkNetwork()) return;
    setLoading(true);
    setStatus("Submitting deliverable on ERC-8183...");
    try {
      const erc8183    = getERC8183(wallet.signer, net.erc8183);
      const deliverable = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address"],
          [prop.tokenId, deal.buyer, wallet.address]
        )
      );
      await (await erc8183.submit(deal.jobId, deliverable, "0x")).wait();
      setStatus("Deliverable submitted. Awaiting admin review.");
      await new Promise(r => setTimeout(r, 4000));
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

      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <input
          style={{ flex: 1, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 2, background: "var(--warm-white)", fontSize: 13, outline: "none" }}
          placeholder="Enter Token ID"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
        />
        <button onClick={() => loadProperty(inputId)} style={{
          padding: "10px 20px", border: "none", background: "var(--charcoal)",
          color: "var(--warm-white)", borderRadius: 2, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer",
        }}>Load</button>
      </div>

      {prop && (
        <div style={{ background: "var(--warm-white)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 24 }}>
          {imageSrc && (
            <img src={imageSrc} alt={prop.location} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
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

            {!isSeller && wallet.address && usdcBalance !== null && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "var(--cream)", borderRadius: 2, fontSize: 12, color: "var(--mid)" }}>
                Your USDC balance:{" "}
                <strong style={{ color: hasSufficientBalance ? "var(--green)" : "var(--red)" }}>
                  {ethers.formatUnits(usdcBalance, 6)} USDC
                </strong>
                {!hasSufficientBalance && <span style={{ color: "var(--red)", marginLeft: 8 }}>— insufficient</span>}
              </div>
            )}

            {rejectionReason && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(139,44,44,0.06)", border: "1px solid rgba(139,44,44,0.3)", borderRadius: 2, fontSize: 12, color: "var(--red)" }}>
                <strong>Last deal rejected</strong> — {rejectionReason}
              </div>
            )}

            {/* Verification status badge */}
            {prop.status !== 2 && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: isVerified ? "rgba(45,106,79,0.06)" : "rgba(139,44,44,0.06)",
                border: `1px solid ${isVerified ? "rgba(45,106,79,0.3)" : "rgba(139,44,44,0.3)"}`,
                borderRadius: 2, fontSize: 12,
                color: isVerified ? "var(--green)" : "var(--red)",
              }}>
                {isVerified ? "Verified by platform" : "Not yet verified — buyer protection pending"}
              </div>
            )}

            {prop.status === 1 && deal && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(184,151,42,0.06)", border: "1px solid rgba(184,151,42,0.3)", borderRadius: 2, fontSize: 12, color: "var(--gold)" }}>
                In escrow — ERC-8183 job #{deal.jobId.toString()} status:{" "}
                <strong>{jobStatus !== null ? JOB_STATUS[jobStatus] ?? jobStatus : "..."}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {prop && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Seller: request ERC-8004 verification when not yet verified */}
          {isSeller && prop.status === 0 && !isVerified && (
            <div style={{ display: "grid", gap: 10 }}>
              <input
                style={{ padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 2, background: "var(--warm-white)", fontSize: 13, outline: "none" }}
                placeholder="Your ERC-8004 Agent ID (e.g. 1834)"
                value={agentIdInput}
                onChange={e => setAgentIdInput(e.target.value)}
              />
              <input
                style={{ padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 2, background: "var(--warm-white)", fontSize: 13, outline: "none" }}
                placeholder="Property docs IPFS URI (ipfs://...)"
                value={docsURIInput}
                onChange={e => setDocsURIInput(e.target.value)}
              />
              <button onClick={requestVerification} disabled={loading} style={{
                padding: "12px", border: "1px solid var(--gold)",
                background: "transparent", color: "var(--gold)",
                borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
                textTransform: "uppercase", cursor: "pointer",
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? "Processing..." : "Request Platform Verification"}
              </button>
              <p style={{ fontSize: 11, color: "var(--mid)", textAlign: "center", margin: 0 }}>
                Buyers cannot purchase until this property is verified.
              </p>
            </div>
          )}

          {/* Buyer: buy now */}
          {!isSeller && prop.status === 0 && (
            <button onClick={buyNow} disabled={loading || !hasSufficientBalance} style={{
              padding: "12px", border: "none",
              background: hasSufficientBalance ? "var(--gold)" : "var(--border)",
              color: "var(--warm-white)", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: hasSufficientBalance ? "pointer" : "not-allowed",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading
                ? (status.startsWith("Step") ? status : "Processing...")
                : `Buy Now · ${prop.price ? ethers.formatUnits(prop.price, 6) : "..."} USDC`}
            </button>
          )}

          {/* Seller: Step 1 — set budget + fund job combined (job Open=0, not yet funded) */}
          {isSeller && prop.status === 1 && deal && jobStatus === 0 && !deal.isFunded && (
            <button onClick={setBudgetAndFund} disabled={loading} style={{
              padding: "12px", border: "none", background: "var(--charcoal)",
              color: "var(--warm-white)", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer", opacity: loading ? 0.7 : 1,
            }}>
              {loading
                ? (status.startsWith("Step") ? status : "Processing...")
                : `Step 1 — Set Budget & Fund · ${ethers.formatUnits(prop.price, 6)} USDC`}
            </button>
          )}

          {/* Seller: Step 2 — submit deliverable on ERC-8183 (only when job is Funded=1) */}
          {isSeller && prop.status === 1 && deal && jobStatus === 1 && (
            <button onClick={submitDeliverable} disabled={loading} style={{
              padding: "12px", border: "none", background: "var(--charcoal)",
              color: "var(--warm-white)", borderRadius: 2,
              fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer", opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Processing..." : "Step 2 — Submit Deliverable"}
            </button>
          )}

          {/* Seller: waiting for admin after submission */}
          {isSeller && prop.status === 1 && deal && jobStatus === 2 && (
            <div style={{ padding: "12px 16px", background: "rgba(45,106,79,0.06)", border: "1px solid rgba(45,106,79,0.3)", borderRadius: 2, fontSize: 12, color: "var(--green)", textAlign: "center" }}>
              Deliverable submitted — awaiting admin review
            </div>
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
