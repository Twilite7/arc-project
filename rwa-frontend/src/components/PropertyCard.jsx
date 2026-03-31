import { ethers } from "ethers";
import StatusBadge from "./StatusBadge.jsx";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";

function parseDescription(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      desc: parsed.desc || "",
      imageSrc: parsed.image
        ? parsed.image.replace("ipfs://", `${GATEWAY}/`)
        : null,
    };
  } catch {
    return { desc: raw, imageSrc: null };
  }
}

export default function PropertyCard({ prop, onBuy }) {
  const { desc, imageSrc } = parseDescription(prop.description);

  return (
    <div
      style={{
        background: "var(--warm-white)",
        border: "1px solid var(--border)",
        borderRadius: 4, overflow: "hidden",
        transition: "box-shadow 0.2s, transform 0.2s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = "var(--shadow)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Image or GPS placeholder */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={prop.location}
          style={{
            width: "100%", height: 180,
            objectFit: "cover",
            borderBottom: "1px solid var(--border)",
            display: "block",
          }}
        />
      ) : (
        <div style={{
          height: 180, background: "var(--cream)",
          display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: "1px solid var(--border)",
          flexDirection: "column", gap: 4,
        }}>
          <span style={{ fontSize: 28 }}>📍</span>
          <span style={{ fontSize: 11, color: "var(--mid)", fontFamily: "monospace" }}>
            {prop.latitude}, {prop.longitude}
          </span>
        </div>
      )}

      <div style={{ padding: "20px 24px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: "var(--mid)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Token #{prop.tokenId}
          </span>
          <StatusBadge status={prop.status} />
        </div>

        <h3 style={{
          fontFamily: "Cormorant Garamond, serif",
          fontSize: 18, fontWeight: 400,
          marginBottom: 6, lineHeight: 1.3,
        }}>{prop.location}</h3>

        <p style={{ fontSize: 12, color: "var(--mid)", marginBottom: 16, lineHeight: 1.5 }}>
          {desc.slice(0, 80)}{desc.length > 80 ? "..." : ""}
        </p>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 2 }}>Size</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{prop.size}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 2 }}>Price</div>
            <div style={{
              fontFamily: "Cormorant Garamond, serif",
              fontSize: 20, fontWeight: 600, color: "var(--gold)",
            }}>
              {ethers.formatUnits(prop.price, 6)} XUSD
            </div>
          </div>
        </div>

        {prop.status === 0 && (
          <button onClick={() => onBuy(prop.tokenId)} style={{
            width: "100%", marginTop: 16,
            padding: "10px", border: "none",
            background: "var(--charcoal)", color: "var(--warm-white)",
            borderRadius: 2, fontSize: 12,
            letterSpacing: "0.08em", textTransform: "uppercase",
            cursor: "pointer",
          }}>Acquire Property</button>
        )}
      </div>
    </div>
  );
}
