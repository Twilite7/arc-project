import { useRegistry } from "../hooks/useRegistry.js";
import PropertyCard from "../components/PropertyCard.jsx";

export default function Browse({ wallet, onBuy }) {
  const reg = useRegistry(wallet.signer, wallet.provider);

  return (
    <div>
      <div style={{ marginBottom: 48 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          On-Chain Real Estate
        </p>
        <h1 style={{ fontSize: 52, fontWeight: 300, marginBottom: 16 }}>
          Tokenized Properties
        </h1>
        <p style={{ color: "var(--mid)", maxWidth: 480 }}>
          Every asset verified on Arc Testnet. Ownership transferred via smart contract escrow.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 13, color: "var(--mid)" }}>
          {reg.loading ? "Loading..." : `${reg.properties.length} properties`}
        </span>
        <button onClick={reg.fetchProperties} style={{
          padding: "6px 14px", border: "1px solid var(--border)",
          background: "transparent", borderRadius: 2, fontSize: 12, color: "var(--mid)",
          cursor: "pointer",
        }}>Refresh</button>
      </div>

      {reg.properties.length === 0 && !reg.loading && (
        <div style={{
          padding: "40px", textAlign: "center",
          border: "1px dashed var(--border)", borderRadius: 4, color: "var(--mid)",
        }}>
          No properties listed yet
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 24,
      }}>
        {reg.properties.map(prop => (
          <PropertyCard key={prop.tokenId} prop={prop} onBuy={onBuy} />
        ))}
      </div>
    </div>
  );
}
