import { useState, useEffect } from "react";
import { ethers } from "ethers";
import StatusBadge from "../components/StatusBadge.jsx";
import RegistryABI from "../abis/PropertyRegistry.json";
import EscrowABI from "../abis/PropertyEscrow.json";

const REGISTRY_ADDRESS = "0x6DCD95DD67c342EbfdF4355ef97f1A1ee9553028";
const ESCROW_ADDRESS   = "0x701FfaaE7a48C7756B2F6115EDC09A8E0331BCf0";
const XUSD_ADDRESS     = "0x7b7821a895fE26bF3C6A8293D4b984f10A7E38b5";
const GATEWAY          = "https://gateway.pinata.cloud/ipfs";
const ZERO_ADDR        = "0x0000000000000000000000000000000000000000";

// Minimal ERC-20 ABI — only what we need for approve + allowance
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

function getRegistry(signerOrProvider) {
  return new ethers.Contract(REGISTRY_ADDRESS, RegistryABI.abi, signerOrProvider);
}
function getEscrow(signerOrProvider) {
  return new ethers.Contract(ESCROW_ADDRESS, EscrowABI.abi, signerOrProvider);
}
function getXUSD(signerOrProvider) {
  return new ethers.Contract(XUSD_ADDRESS, ERC20_ABI, signerOrProvider);
}

export default function BuyProperty({ wallet, tokenId }) {
  const [prop, setProp] = useState(null);
  const [deal, setDeal] = useState(null);
  const [xusdBalance, setXusdBalance] = useState(null);
  const [xusdAllowance, setXusdAllowance] = useState(null);
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

      // I also load XUSD balance and allowance if wallet is connected
      if (wallet.address) {
        const xusd = getXUSD(provider);
        const [bal, allowance] = await Promise.all([
          xusd.balanceOf(wallet.address),
          xusd.allowance(wallet.address, ESCROW_ADDRESS),
        ]);
        setXusdBalance(bal);
        setXusdAllowance(allowance);
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

  // ── Step 1: Buyer approves XUSD spending ──────────────────────
  async function approveXUSD() {
    if (!wallet.signer || !prop) return;
    setLoading(true); setStatus("Approving XUSD in MetaMask...");
    try {
      const xusd = getXUSD(wallet.signer);
      const tx = await xusd.approve(ESCROW_ADDRESS, prop.price);
      await tx.wait();
      setStatus("XUSD approved. Now click Buy Now to complete.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ── Step 2: Buyer calls buyNow — opens deal and escrows XUSD atomically ──
  async function buyNow() {
    if (!wallet.signer || !prop) return;
    setLoading(true); setStatus("Submitting purchase in MetaMask...");
    try {
      const escrow = getEscrow(wallet.signer);
      const tx = await escrow.buyNow(prop.tokenId);
      await tx.wait();
      setStatus("Purchase submitted. Now sign to finalise ownership transfer.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ── Step 3: Buyer signs to finalise ───────────────────────────
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
      setStatus("Deal complete! Property transferred to your wallet.");
      await loadProperty(prop.tokenId.toString());
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  // ── Seller: withdraw XUSD ─────────────────────────────────────
  async function withdrawFunds() {
    if (!wallet.signer) return;
    setLoading(true); setStatus("Checking pending balance...");
    try {
      const escrow = getEscrow(wallet.signer);
      const pending = await escrow.getPendingWithdrawal(wallet.address);
      if (pending === 0n) { setStatus("No funds to withdraw."); setLoading(false); return; }
      setStatus("Withdrawing XUSD...");
      const tx = await escrow.withdrawFunds();
      await tx.wait();
      setStatus(`Withdrawn ${ethers.formatUnits(pending, 6)} XUSD successfully.`);
    } catch (e) { setStatus("Error: " + (e.reason || e.message)); }
    setLoading(false);
  }

  const isSeller = prop && wallet.address &&
    prop.owner.toLowerCase() === wallet.address.toLowerCase();

  const isBuyer = deal && wallet.address && deal.buyer &&
    deal.buyer.toLowerCase() === wallet.address.toLowerCase() &&
    deal.buyer.toLowerCase() !== ZERO_ADDR;

  const noBuyerYet = !deal?.buyer || deal.buyer.toLowerCase() === ZERO_ADDR;

  // I check if buyer has enough allowance to call buyNow
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

            {/* XUSD balance info for buyers */}
            {!isSeller && wallet.address && xusdBalance !== null && (
              <div style={{
                marginTop: 16, padding: "10px 14px",
                background: "var(--cream)", borderRadius: 2,
                fontSize: 12, color: "var(--mid)",
              }}>
                Your XUSD balance: <strong style={{ color: hasSufficientBalance ? "var(--green)" : "var(--red)" }}>
                  {ethers.formatUnits(xusdBalance, 6)} XUSD
                </strong>
                {!hasSufficientBalance && (
                  <span style={{ color: "var(--red)", marginLeft: 8 }}>— insufficient balance</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {prop && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Buyer flow: approve then buyNow */}
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

          {!isSeller && prop.status === 0 && hasAllowance && (
            <button onClick={buyNow} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--gold)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>
              {loading ? "Processing..." : `Buy Now — ${prop.price ? ethers.formatUnits(prop.price, 6) : "..."} XUSD`}
            </button>
          )}

          {/* Buyer: sign to finalise */}
          {isBuyer && !deal.buyerSigned && (
            <button onClick={sign} disabled={loading} style={{
              padding: "12px", border: "none",
              background: "var(--charcoal)", color: "var(--warm-white)",
              borderRadius: 2, fontSize: 12, letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
            }}>Sign & Finalise Ownership Transfer</button>
          )}

          {/* Seller: withdraw XUSD */}
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
