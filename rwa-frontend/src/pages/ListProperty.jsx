import { useState } from "react";
import { ethers } from "ethers";
import { useRegistry } from "../hooks/useRegistry.js";

const inputStyle = {
  width: "100%", padding: "10px 14px",
  border: "1px solid var(--border)", borderRadius: 2,
  background: "var(--warm-white)", fontSize: 13,
  outline: "none", transition: "border-color 0.2s",
};

const labelStyle = {
  display: "block", fontSize: 11,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--mid)", marginBottom: 6,
};

export default function ListProperty({ wallet }) {
  const reg = useRegistry(wallet.signer, wallet.provider);
  const [form, setForm] = useState({
    location: "", latitude: "", longitude: "",
    size: "", price: "", description: "", docsFile: null,
  });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit() {
    if (!wallet.signer) { setStatus("Connect wallet first."); return; }
    if (!form.location || !form.latitude || !form.longitude || !form.size || !form.price) {
      setStatus("Fill in all required fields."); return;
    }
    setLoading(true);
    setStatus("Checking verified lister status...");
    try {
      const registry = reg.getRegistry(wallet.signer);

      const isListed = await registry.verifiedListers(wallet.address);
      if (!isListed) { setStatus("Your wallet is not a verified lister. Contact admin."); setLoading(false); return; }

      const price = ethers.parseEther(form.price);
      const docsHash = form.docsFile
        ? ethers.keccak256(ethers.toUtf8Bytes(form.docsFile.name + Date.now()))
        : ethers.keccak256(ethers.toUtf8Bytes("placeholder-docs-" + Date.now()));

      setStatus("Sign the property details in MetaMask...");

      const messageHash = ethers.solidityPackedKeccak256(
        ["string", "string", "string", "string", "uint256", "bytes32"],
        [form.location, form.latitude, form.longitude, form.size, price, docsHash]
      );
      const sellerSig = await wallet.signer.signMessage(ethers.getBytes(messageHash));

      setStatus("Submitting transaction...");
      const tx = await registry.listProperty(
        form.location, form.latitude, form.longitude,
        form.size, price, form.description, docsHash, sellerSig
      );
      await tx.wait();

      setStatus("Property listed successfully!");
      setForm({ location: "", latitude: "", longitude: "", size: "", price: "", description: "", docsFile: null });
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Verified Listers Only
        </p>
        <h1 style={{ fontSize: 48, fontWeight: 300 }}>List an Asset</h1>
      </div>

      <div style={{ display: "grid", gap: 20 }}>
        <div>
          <label style={labelStyle}>Location *</label>
          <input style={inputStyle} placeholder="123 Victoria Island, Lagos, Nigeria"
            value={form.location} onChange={e => set("location", e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Latitude *</label>
            <input style={inputStyle} placeholder="6.4281"
              value={form.latitude} onChange={e => set("latitude", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Longitude *</label>
            <input style={inputStyle} placeholder="3.4219"
              value={form.longitude} onChange={e => set("longitude", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Size *</label>
            <input style={inputStyle} placeholder="800 sqm"
              value={form.size} onChange={e => set("size", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Price (ETH) *</label>
            <input style={inputStyle} placeholder="0.001" type="number" step="0.0001"
              value={form.price} onChange={e => set("price", e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, height: 100, resize: "vertical" }}
            placeholder="Waterfront commercial property with sea view..."
            value={form.description} onChange={e => set("description", e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>Legal Documents (optional)</label>
          <input type="file" style={{ fontSize: 12, color: "var(--mid)" }}
            onChange={e => set("docsFile", e.target.files[0])} />
          <p style={{ fontSize: 11, color: "var(--mid)", marginTop: 6 }}>
            File hash will be stored on-chain. File itself should be uploaded to IPFS separately.
          </p>
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{
          padding: "14px", border: "none",
          background: loading ? "var(--light)" : "var(--charcoal)",
          color: "var(--warm-white)", borderRadius: 2,
          fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {loading ? "Processing..." : "List Property"}
        </button>

        {status && (
          <div style={{
            padding: "12px 16px", borderRadius: 2, fontSize: 12,
            background: status.includes("Error") ? "rgba(139,44,44,0.06)" : "rgba(45,106,79,0.06)",
            border: `1px solid ${status.includes("Error") ? "var(--red)" : "var(--green)"}30`,
            color: status.includes("Error") ? "var(--red)" : "var(--green)",
          }}>{status}</div>
        )}
      </div>
    </div>
  );
}
