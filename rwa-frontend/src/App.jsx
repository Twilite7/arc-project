import { useState } from "react";
import Navbar from "./components/Navbar.jsx";
import Browse from "./pages/Browse.jsx";
import ListProperty from "./pages/ListProperty.jsx";
import BuyProperty from "./pages/BuyProperty.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import { useWallet } from "./hooks/useWallet.js";

export default function App() {
  const [page, setPage] = useState("browse");
  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const wallet = useWallet();

  function goToBuy(tokenId) {
    setSelectedTokenId(tokenId);
    setPage("buy");
  }

  return (
    <div className={darkMode ? "dark" : ""} style={{ minHeight: "100vh", background: "var(--cream)" }}>
      <Navbar page={page} setPage={setPage} wallet={wallet} darkMode={darkMode} setDarkMode={setDarkMode} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px" }}>
        {page === "browse"  && <Browse wallet={wallet} onBuy={goToBuy} />}
        {page === "list"    && <ListProperty wallet={wallet} />}
        {page === "buy"     && <BuyProperty wallet={wallet} tokenId={selectedTokenId} />}
        {page === "admin"   && <AdminDashboard wallet={wallet} />}
      </main>
    </div>
  );
}
