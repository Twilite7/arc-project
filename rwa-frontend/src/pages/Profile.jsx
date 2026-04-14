import { useState, useEffect } from "react";
import { ethers } from "ethers";
import EscrowABI from "../abis/PropertyEscrow8183.json";

const GATEWAY = "https://gateway.pinata.cloud/ipfs";

const DEAL_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

function parseImage(description) {
  try {
    const p = JSON.parse(description);
    return p.image ? p.image.replace("ipfs://", GATEWAY + "/") : null;
  } catch { return null; }
}

export default function Profile({ wallet }) {
  const net = wallet.network;

  const [activeDeals, setActiveDeals]     = useState([]);
  const [pastDeals, setPastDeals]         = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [tab, setTab]                     = useState("active");

  useEffect(() => {
    if (wallet.address && wallet.provider && net) loadProfile();
  }, [wallet.address, wallet.provider, net?.escrow]);

  async function loadProfile() {
    if (!wallet.address || !wallet.provider || !net) return;
    setLoading(true);
    try {
      const provider = wallet.provider;
      const escrow   = new ethers.Contract(net.escrow, EscrowABI.abi, provider);
      const registry = new ethers.Contract(
        net.registry,
        ["function getProperty(uint256) view returns (tuple(string,string,string,string,uint256,string,bytes32,bytes,uint8,address[]))",
         "function ownerOf(uint256) view returns (address)"],
        provider
      );
      const erc8183 = new ethers.Contract(
        net.erc8183,
        ["function jobs(uint256) view returns (uint256,address,address,address,string,uint256,uint256,uint8,address,bytes32)"],
        provider
      );

      const currentBlock = await provider.getBlockNumber();
      const fromBlock    = net.deployBlock;
      const CHUNK        = 9000;

      // I scan DealCreated events for this buyer
      let createdEvents = [];
      for (let from = fromBlock; from <= currentBlock; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, currentBlock);
        try {
          const chunk = await escrow.queryFilter(
            escrow.filters.DealCreated(null, null, wallet.address),
            from, to
          );
          createdEvents = createdEvents.concat(chunk);
        } catch {}
      }

      // I scan DealReleased and DealRejected events for this buyer
      let releasedEvents = [], rejectedEvents = [];
      for (let from = fromBlock; from <= currentBlock; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, currentBlock);
        try {
          const [rel, rej] = await Promise.all([
            escrow.queryFilter(escrow.filters.DealReleased(), from, to),
            escrow.queryFilter(escrow.filters.DealRejected(), from, to),
          ]);
          releasedEvents = releasedEvents.concat(rel);
          rejectedEvents = rejectedEvents.concat(rej);
        } catch {}
      }

      // I index completed/rejected deals by tokenId for fast lookup
      const releasedIds = new Set(releasedEvents.map(e => e.args.tokenId.toString()));
      const rejectedMap = {};
      for (const e of rejectedEvents) {
        rejectedMap[e.args.tokenId.toString()] = e.args.reason || "No reason provided";
      }

      const active = [], past = [], notifs = [];

      for (const e of createdEvents) {
        const tokenId  = e.args.tokenId;
        const jobId    = e.args.jobId;
        const price    = e.args.price;
        const tid      = tokenId.toString();

        let prop, jobStatus, location, imageSrc;
        try {
          prop      = await registry.getProperty(tokenId);
          location  = prop[0];
          imageSrc  = parseImage(prop[5]);
        } catch { location = "Unknown"; imageSrc = null; }

        try {
          const job = await erc8183.jobs(jobId);
          jobStatus = Number(job[7]);
        } catch { jobStatus = 0; }

        const deal = {
          tokenId:   tid,
          jobId:     jobId.toString(),
          price:     ethers.formatUnits(price, 6),
          location,
          imageSrc,
          jobStatus,
          txHash:    e.transactionHash,
          blockNumber: e.blockNumber,
        };

        if (releasedIds.has(tid)) {
          past.push({ ...deal, outcome: "completed" });
          notifs.push({ type: "success", message: `Property #${tid} transfer completed`, tokenId: tid });
        } else if (rejectedMap[tid]) {
          past.push({ ...deal, outcome: "rejected", reason: rejectedMap[tid] });
          notifs.push({ type: "error", message: `Deal #${tid} rejected — ${rejectedMap[tid]}`, tokenId: tid });
        } else {
          // I check if still active on-chain
          try {
            const isActive = await escrow.activeDeal(tokenId);
            if (isActive) {
              active.push(deal);
              if (jobStatus === 2) {
                notifs.push({ type: "info", message: `Property #${tid} deliverable submitted — awaiting admin review`, tokenId: tid });
              }
            } else {
              past.push({ ...deal, outcome: "expired" });
            }
          } catch {
            active.push(deal);
          }
        }
      }

      setActiveDeals(active);
      setPastDeals(past);
      setNotifications(notifs.reverse());
    } catch (e) { console.error("loadProfile error:", e); }
    setLoading(false);
  }

  const tabStyle = (t) => ({
    padding: "8px 20px",
    border: "none",
    borderBottom: tab === t ? "2px solid var(--gold)" : "2px solid transparent",
    background: "transparent",
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: tab === t ? "var(--gold)" : "var(--mid)",
    cursor: "pointer",
  });

  const cardStyle = {
    background: "var(--warm-white)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 16,
  };

  function DealCard({ deal, outcome, reason }) {
    const outcomeColor = { completed: "var(--green)", rejected: "var(--red)", expired: "var(--mid)" };
    const outcomeLabel = { completed: "Completed", rejected: "Rejected", expired: "Expired" };
    const jobLabel     = DEAL_STATUS[deal.jobStatus] ?? deal.jobStatus;

    async function addToMetaMask() {
      try {
        await window.ethereum.request({
          method: "wallet_watchAsset",
          params: {
            type: "ERC721",
            options: {
              address: net.registry,
              tokenId: deal.tokenId,
            },
          },
        });
      } catch (e) { console.error("wallet_watchAsset failed:", e); }
    }

    return (
      <div style={cardStyle}>
        {deal.imageSrc && (
          <img src={deal.imageSrc} alt={deal.location}
            style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }} />
        )}
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 4 }}>Token #{deal.tokenId}</div>
              <div style={{ fontSize: 16, fontWeight: 400 }}>{deal.location}</div>
            </div>
            {outcome ? (
              <span style={{ fontSize: 11, color: outcomeColor[outcome], fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {outcomeLabel[outcome]}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {jobLabel}
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 2 }}>Price Paid</div>
              <div style={{ fontWeight: 500 }}>{deal.price} USDC</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--mid)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 2 }}>ERC-8183 Job</div>
              <div style={{ fontWeight: 500 }}>#{deal.jobId}</div>
            </div>
          </div>

          {reason && (
            <div style={{ marginTop: 12, padding: "8px 12px",
              background: "rgba(139,44,44,0.06)", borderRadius: 2,
              fontSize: 12, color: "var(--red)" }}>
              <strong>Rejection reason:</strong> {reason}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
            <a href={`https://testnet.arcscan.app/tx/${deal.txHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: "var(--mid)", textDecoration: "none",
                borderBottom: "1px solid var(--border)" }}>
              View transaction
            </a>
            {outcome === "completed" && (
              <button onClick={addToMetaMask} style={{
                fontSize: 11, padding: "4px 10px",
                border: "1px solid var(--border)", borderRadius: 2,
                background: "transparent", color: "var(--mid)", cursor: "pointer",
              }}>
                Add to MetaMask
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.15em",
          textTransform: "uppercase", marginBottom: 12 }}>Buyer</p>
        <h1 style={{ fontSize: 48, fontWeight: 300, marginBottom: 8 }}>My Profile</h1>
        {wallet.address && (
          <p style={{ fontSize: 12, color: "var(--mid)", fontFamily: "monospace" }}>
            {wallet.address}
          </p>
        )}
      </div>

      {!wallet.address ? (
        <div style={{ padding: 24, border: "1px dashed var(--border)",
          borderRadius: 4, color: "var(--mid)", fontSize: 13 }}>
          Connect your wallet to view your profile
        </div>
      ) : loading ? (
        <div style={{ padding: 24, color: "var(--mid)", fontSize: 13 }}>
          Loading your deals...
        </div>
      ) : (
        <>
          {/* Notifications */}
          {notifications.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                color: "var(--gold)", marginBottom: 12 }}>Notifications</div>
              {notifications.map((n, i) => (
                <div key={i} style={{
                  padding: "10px 14px", borderRadius: 2, fontSize: 12, marginBottom: 8,
                  background: n.type === "success" ? "rgba(45,106,79,0.06)"
                    : n.type === "error" ? "rgba(139,44,44,0.06)"
                    : "rgba(184,151,42,0.06)",
                  border: `1px solid ${n.type === "success" ? "rgba(45,106,79,0.3)"
                    : n.type === "error" ? "rgba(139,44,44,0.3)"
                    : "rgba(184,151,42,0.3)"}`,
                  color: n.type === "success" ? "var(--green)"
                    : n.type === "error" ? "var(--red)"
                    : "var(--gold)",
                }}>
                  {n.message}
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
            <button style={tabStyle("active")} onClick={() => setTab("active")}>
              Active ({activeDeals.length})
            </button>
            <button style={tabStyle("past")} onClick={() => setTab("past")}>
              History ({pastDeals.length})
            </button>
          </div>

          {tab === "active" && (
            activeDeals.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center",
                border: "1px dashed var(--border)", borderRadius: 4, color: "var(--mid)" }}>
                No active deals
              </div>
            ) : (
              activeDeals.map(d => <DealCard key={d.tokenId} deal={d} />)
            )
          )}

          {tab === "past" && (
            pastDeals.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center",
                border: "1px dashed var(--border)", borderRadius: 4, color: "var(--mid)" }}>
                No purchase history
              </div>
            ) : (
              pastDeals.map(d => (
                <DealCard key={d.tokenId + d.outcome} deal={d}
                  outcome={d.outcome} reason={d.reason} />
              ))
            )
          )}

          <button onClick={loadProfile} style={{
            marginTop: 16, padding: "8px 20px",
            border: "1px solid var(--border)", background: "transparent",
            borderRadius: 2, fontSize: 12, color: "var(--mid)",
            letterSpacing: "0.06em", cursor: "pointer",
          }}>Refresh</button>
        </>
      )}
    </div>
  );
}
