import { useState } from "react";
import { ethers } from "ethers";
import { useRegistry } from "../hooks/useRegistry.js";

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

const inputStyle = {
  width: "100%", padding: "10px 14px",
  border: "1px solid var(--border)", borderRadius: 2,
  background: "var(--warm-white)", fontSize: 13,
  outline: "none",
};

const labelStyle = {
  display: "block", fontSize: 11,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--mid)", marginBottom: 6,
};

async function uploadToPinata(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pinataMetadata", JSON.stringify({ name: file.name }));
  formData.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: formData,
  });

  if (!res.ok) throw new Error("Pinata upload failed: " + res.statusText);
  const data = await res.json();
  return data.IpfsHash;
}

function validateForm(form) {
  if (!form.location.trim()) return "Location is required.";
  const lat = parseFloat(form.latitude);
  const lng = parseFloat(form.longitude);
  if (isNaN(lat) || lat < -90  || lat > 90)  return "Latitude must be between -90 and 90.";
  if (isNaN(lng) || lng < -180 || lng > 180) return "Longitude must be between -180 and 180.";
  if (!form.size.trim()) return "Size is required.";
  const price = parseFloat(form.price);
  if (isNaN(price) || price <= 0) return "Price must be a positive number.";
  if (form.description.length > 500) return "Description must be under 500 characters.";
  return null;
}

export default function ListProperty({ wallet }) {
  const reg = useRegistry(wallet.signer, wallet.provider, wallet.chainId);
  const [form, setForm] = useState({
    location: "", latitude: "", longitude: "",
    size: "", price: "", description: "",
    imageFile: null, docsFile: null,
  });
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("File must be an image (jpg, png, webp, etc.).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus("Image must be under 5MB.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    set("imageFile", file);
    setPreview(URL.createObjectURL(file));
    setStatus("");
  }

  async function handleSubmit() {
    if (!wallet.signer) { setStatus("Connect wallet first."); return; }
    const validationError = validateForm(form);
    if (validationError) { setStatus(validationError); return; }

    setLoading(true);
    try {
      const registry = reg.getRegistry(wallet.signer);

      const isVerified = await registry.verifiedListers(wallet.address);
      if (!isVerified) {
        setStatus("Your wallet is not a verified lister. Contact admin.");
        setLoading(false);
        return;
      }

      let imageCid = null;
      if (form.imageFile) {
        setStatus("Uploading image to IPFS...");
        imageCid = await uploadToPinata(form.imageFile);
      }

      const descPayload = JSON.stringify({
        desc: form.description,
        ...(imageCid && { image: `ipfs://${imageCid}` }),
      });

      const price = ethers.parseUnits(form.price, 6);
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
        form.size, price, descPayload, docsHash, sellerSig
      );
      await tx.wait();

      setStatus("Property listed successfully!");
      if (preview) URL.revokeObjectURL(preview);
      setForm({ location: "", latitude: "", longitude: "", size: "", price: "", description: "", imageFile: null, docsFile: null });
      setPreview(null);
    } catch (e) {
      setStatus("Error: " + (e.reason || e.message));
    }
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
            <label style={labelStyle}>Latitude * (-90 to 90)</label>
            <input style={inputStyle} placeholder="6.4281" type="number" step="any"
              value={form.latitude} onChange={e => set("latitude", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Longitude * (-180 to 180)</label>
            <input style={inputStyle} placeholder="3.4219" type="number" step="any"
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
            <label style={labelStyle}>Price (XUSD) *</label>
            <input style={inputStyle} placeholder="50" type="number" step="0.0001" min="0"
              value={form.price} onChange={e => set("price", e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            Description
            <span style={{ float: "right", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {form.description.length}/500
            </span>
          </label>
          <textarea style={{ ...inputStyle, height: 90, resize: "vertical" }}
            placeholder="Waterfront commercial property with sea view..."
            maxLength={500}
            value={form.description} onChange={e => set("description", e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>Property Image (max 5MB)</label>
          <input
            type="file"
            accept="image/*"
            style={{ fontSize: 12, color: "var(--mid)" }}
            onChange={handleImageChange}
          />
          {preview && (
            <div style={{ marginTop: 12 }}>
              <img src={preview} alt="preview"
                style={{
                  width: "100%", maxHeight: 220,
                  objectFit: "cover", borderRadius: 4,
                  border: "1px solid var(--border)",
                }} />
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--mid)", marginTop: 6 }}>
            Uploaded to IPFS via Pinata. CID stored on-chain.
          </p>
        </div>

        <div>
          <label style={labelStyle}>Legal Documents (optional)</label>
          <input type="file" style={{ fontSize: 12, color: "var(--mid)" }}
            onChange={e => set("docsFile", e.target.files[0])} />
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{
          padding: "14px", border: "none",
          background: loading ? "var(--light)" : "var(--charcoal)",
          color: "var(--warm-white)", borderRadius: 2,
          fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
          cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "Processing..." : "List Property"}
        </button>

        {status && (
          <div style={{
            padding: "12px 16px", borderRadius: 2, fontSize: 12,
            background: status.includes("Error") || status.includes("required") || status.includes("must")
              ? "rgba(139,44,44,0.06)" : "rgba(45,106,79,0.06)",
            border: `1px solid ${
              status.includes("Error") || status.includes("required") || status.includes("must")
              ? "var(--red)" : "var(--green)"}30`,
            color: status.includes("Error") || status.includes("required") || status.includes("must")
              ? "var(--red)" : "var(--green)",
          }}>{status}</div>
        )}
      </div>
    </div>
  );
}
