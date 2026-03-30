export default function Navbar({ page, setPage, wallet, darkMode, setDarkMode }) {
  const tabs = [
    { id: "browse", label: "Properties" },
    { id: "list",   label: "List Asset" },
    { id: "buy",    label: "Acquire" },
    { id: "admin",  label: "Admin" },
  ];

  return (
    <header style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--warm-white)",
      position: "sticky", top: 0, zIndex: 100,
      transition: "background 0.2s",
    }}>
      <div style={{
        maxWidth: 1100, margin: "0 auto",
        padding: "0 24px",
        display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 64,
      }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 22, fontWeight: 300, color: "var(--gold)", letterSpacing: "0.02em",
          }}>Zeno</span>
          <span style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 22, fontWeight: 600, color: "var(--gold)",
          }}>Estate</span>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: "flex", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setPage(t.id)} style={{
              padding: "6px 16px", border: "none", borderRadius: 2,
              background: page === t.id ? "var(--charcoal)" : "transparent",
              color: page === t.id ? "var(--warm-white)" : "var(--mid)",
              fontSize: 13, letterSpacing: "0.04em",
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </nav>

        {/* Right side: dark mode + wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              width: 36, height: 36,
              border: "1px solid var(--border)",
              borderRadius: 2, background: "transparent",
              color: "var(--mid)", fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            {darkMode ? "☀" : "☽"}
          </button>

          {/* Wallet */}
          {!wallet.address ? (
            <button onClick={wallet.connect} style={{
              padding: "8px 20px",
              background: "transparent",
              border: "1px solid var(--charcoal)",
              borderRadius: 2, fontSize: 12,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: "var(--charcoal)",
            }}>Connect Wallet</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 12, color: "var(--mid)",
                fontFamily: "monospace",
              }}>
                {wallet.address.slice(0,6)}...{wallet.address.slice(-4)}
              </span>
              <button onClick={wallet.disconnect} style={{
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 2, fontSize: 11,
                letterSpacing: "0.06em", textTransform: "uppercase",
                color: "var(--mid)",
              }}>Disconnect</button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
