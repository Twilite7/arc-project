import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import ClaudeNFT from "./ClaudeNFT.json";

const CONTRACT_ADDRESS = "0x9c6B711782686528d63799f92211630711d07B0F";
const ROBINHOOD_CHAIN_ID = 46630;

// Matrix rain canvas
function MatrixRain() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const cols = Math.floor(canvas.width / 16);
    const drops = Array(cols).fill(1);
    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF∴∵∶∷";
    function draw() {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = "14px monospace";
      drops.forEach((y, i) => {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * 16;
        // bright lead char
        ctx.fillStyle = i % 7 === 0 ? "#afffaf" : "#00ff41";
        ctx.fillText(char, x, y * 16);
        if (y * 16 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    }
    const id = setInterval(draw, 45);
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener("resize", onResize);
    return () => { clearInterval(id); window.removeEventListener("resize", onResize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: 0.18 }} />;
}

// Typewriter text
function Typewriter({ text, speed = 40 }) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const id = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text]);
  return <span>{displayed}<span style={{ animation: "blink 1s step-end infinite" }}>_</span></span>;
}

export default function App() {
  const [contract, setContract] = useState(null);
  const [address, setAddress] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [totalSupply, setTotalSupply] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setTimeout(() => setMounted(true), 200); }, []);

  function setMsg(msg, type = "info") { setStatus(msg); setStatusType(type); }

  async function connectWallet() {
    if (!window.ethereum) { setMsg("// ERROR: MetaMask not detected", "error"); return; }
    try {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      await _provider.send("eth_requestAccounts", []);
      const network = await _provider.getNetwork();
      if (Number(network.chainId) !== ROBINHOOD_CHAIN_ID) {
        setMsg("// ERROR: Wrong network. Switch to Robinhood Chain Testnet.", "error"); return;
      }
      const _signer = await _provider.getSigner();
      const _address = await _signer.getAddress();
      const _contract = new ethers.Contract(CONTRACT_ADDRESS, ClaudeNFT.abi, _signer);
      setContract(_contract); setAddress(_address);
      const owner = await _contract.owner();
      const supply = await _contract.totalSupply();
      const whitelisted = await _contract.whitelist(_address);
      setIsOwner(owner.toLowerCase() === _address.toLowerCase());
      setTotalSupply(Number(supply));
      setIsWhitelisted(whitelisted);
      setMsg("// ACCESS GRANTED", "success");
    } catch (err) { setMsg("// ERROR: " + err.message, "error"); }
  }

  async function mint() {
    if (!contract) return;
    setLoading(true); setMsg("// INITIATING MINT SEQUENCE...", "info");
    try {
      const tx = await contract.mint({ value: ethers.parseEther("0.0001") });
      setMsg("// TX BROADCAST: " + tx.hash.slice(0, 20) + "...", "info");
      await tx.wait();
      const supply = await contract.totalSupply();
      setTotalSupply(Number(supply));
      setMsg("// MINT CONFIRMED. WELCOME TO THE MATRIX.", "success");
    } catch (err) { setMsg("// ERROR: " + err.message, "error"); }
    setLoading(false);
  }

  async function addToWhitelist() {
    if (!contract || !whitelistInput) return;
    setLoading(true); setMsg("// WRITING TO WHITELIST...", "info");
    try {
      const tx = await contract.addToWhitelist(whitelistInput);
      await tx.wait();
      setMsg("// AGENT WHITELISTED: " + whitelistInput.slice(0, 10) + "...", "success");
      setWhitelistInput("");
    } catch (err) { setMsg("// ERROR: " + err.message, "error"); }
    setLoading(false);
  }

  async function withdraw() {
    if (!contract) return;
    setLoading(true); setMsg("// EXTRACTING FUNDS...", "info");
    try {
      const tx = await contract.withdraw();
      await tx.wait();
      setMsg("// FUNDS EXTRACTED SUCCESSFULLY.", "success");
    } catch (err) { setMsg("// ERROR: " + err.message, "error"); }
    setLoading(false);
  }

  const pct = (totalSupply / 100) * 100;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=VT323&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #000;
          min-height: 100vh;
          font-family: 'Share Tech Mono', monospace;
          color: #00ff41;
          overflow-x: hidden;
        }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes fadeIn {
          from { opacity:0; transform: translateY(16px); }
          to   { opacity:1; transform: translateY(0); }
        }
        @keyframes glitch {
          0%,100% { text-shadow: 0 0 8px #00ff41, 0 0 20px #00ff41; }
          25% { text-shadow: -2px 0 #ff0000, 2px 0 #00ffff, 0 0 20px #00ff41; }
          75% { text-shadow: 2px 0 #ff0000, -2px 0 #00ffff, 0 0 20px #00ff41; }
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 8px rgba(0,255,65,0.3); }
          50% { box-shadow: 0 0 20px rgba(0,255,65,0.6); }
        }

        .scanline {
          position: fixed; left: 0; right: 0; height: 2px;
          background: rgba(0,255,65,0.06);
          z-index: 2; pointer-events: none;
          animation: scanline 8s linear infinite;
        }

        .wrap {
          position: relative; z-index: 1;
          max-width: 560px; margin: 0 auto;
          padding: 48px 24px 80px;
        }
        .wrap.in > * {
          animation: fadeIn 0.5s ease forwards;
        }
        .wrap.in > *:nth-child(1) { animation-delay: 0.1s; opacity: 0; }
        .wrap.in > *:nth-child(2) { animation-delay: 0.25s; opacity: 0; }
        .wrap.in > *:nth-child(3) { animation-delay: 0.4s; opacity: 0; }
        .wrap.in > *:nth-child(4) { animation-delay: 0.55s; opacity: 0; }
        .wrap.in > *:nth-child(5) { animation-delay: 0.7s; opacity: 0; }

        .header { margin-bottom: 40px; border-left: 2px solid #00ff41; padding-left: 16px; }

        .sys-label {
          font-size: 10px; letter-spacing: 0.2em; color: #00aa2a;
          margin-bottom: 8px; display: block;
        }

        h1 {
          font-family: 'VT323', monospace;
          font-size: 64px; line-height: 1;
          color: #00ff41;
          animation: glitch 4s ease-in-out infinite;
          margin-bottom: 4px;
        }

        .subtitle { font-size: 11px; color: #006614; letter-spacing: 0.1em; }

        .card {
          border: 1px solid #003a0e;
          border-radius: 4px;
          padding: 24px;
          margin-bottom: 12px;
          background: rgba(0,255,65,0.02);
          position: relative;
          animation: pulse 4s ease-in-out infinite;
        }
        .card::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, #00ff41, transparent);
          opacity: 0.3;
        }

        .card-title {
          font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
          color: #006614; margin-bottom: 18px;
        }
        .card-title::before { content: '> '; color: #00ff41; }

        .supply-big {
          font-family: 'VT323', monospace;
          font-size: 56px; color: #00ff41; line-height: 1;
        }
        .supply-sub { font-size: 11px; color: #006614; margin-bottom: 14px; margin-top: 4px; }

        .bar-track {
          height: 6px; background: #001a05; border: 1px solid #003a0e;
          border-radius: 0; overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: repeating-linear-gradient(90deg, #00ff41 0px, #00ff41 8px, #00aa2a 8px, #00aa2a 10px);
          transition: width 0.8s ease;
        }

        .addr {
          font-size: 12px; color: #00aa2a;
          word-break: break-all; margin-bottom: 10px;
        }
        .addr .hi { color: #00ff41; }

        .badge {
          display: inline-block; font-size: 11px;
          padding: 3px 10px; border-radius: 2px;
        }
        .badge.yes { background: rgba(0,255,65,0.1); color: #00ff41; border: 1px solid #00ff41; }
        .badge.no  { background: rgba(255,0,0,0.08); color: #ff4444; border: 1px solid #ff4444; }

        .price-row {
          display: flex; justify-content: space-between;
          font-size: 12px; color: #006614;
          margin-bottom: 18px; padding-bottom: 14px;
          border-bottom: 1px solid #003a0e;
        }
        .price-val { color: #00ff41; }

        .btn {
          width: 100%; padding: 13px;
          border-radius: 2px; cursor: pointer;
          font-family: 'Share Tech Mono', monospace;
          font-size: 13px; letter-spacing: 0.08em;
          transition: all 0.15s;
        }

        .btn-primary {
          background: #00ff41; color: #000; border: none; font-weight: bold;
        }
        .btn-primary:hover:not(:disabled) { background: #afffaf; }
        .btn-primary:disabled { background: #003a0e; color: #006614; cursor: not-allowed; }

        .btn-outline {
          background: transparent; color: #00ff41;
          border: 1px solid #00ff41;
        }
        .btn-outline:hover:not(:disabled) { background: rgba(0,255,65,0.08); }
        .btn-outline:disabled { opacity: 0.3; cursor: not-allowed; }

        .btn-red {
          background: transparent; color: #ff4444;
          border: 1px solid #ff4444;
        }
        .btn-red:hover:not(:disabled) { background: rgba(255,68,68,0.08); }
        .btn-red:disabled { opacity: 0.3; cursor: not-allowed; }

        .input {
          width: 100%; padding: 10px 12px;
          background: #000; border: 1px solid #003a0e;
          color: #00ff41; font-family: 'Share Tech Mono', monospace;
          font-size: 12px; border-radius: 2px; outline: none;
          margin-bottom: 10px;
          transition: border-color 0.2s;
        }
        .input:focus { border-color: #00ff41; }
        .input::placeholder { color: #003a0e; }

        .divider { height: 1px; background: #003a0e; margin: 18px 0; }

        .owner-tag {
          font-size: 10px; color: #ff4444; letter-spacing: 0.15em;
          display: block; margin-bottom: 14px;
        }

        .status {
          padding: 12px 16px; border-radius: 2px;
          font-size: 11px; line-height: 1.6; word-break: break-all;
          margin-top: 12px;
        }
        .status.info    { border: 1px solid #003a0e; color: #00aa2a; background: rgba(0,255,65,0.03); }
        .status.success { border: 1px solid #00ff41; color: #00ff41; background: rgba(0,255,65,0.06); }
        .status.error   { border: 1px solid #ff4444; color: #ff4444; background: rgba(255,68,68,0.06); }
      `}</style>

      <MatrixRain />
      <div className="scanline" />

      <div className={`wrap ${mounted ? "in" : ""}`}>
        <div className="header">
          <span className="sys-label">SYSTEM INITIALIZED // ROBINHOOD CHAIN TESTNET</span>
          <h1>ClaudeNFT</h1>
          <p className="subtitle">ERC-721 PROTOCOL · MAX_SUPPLY=100 · PRICE=0.0001_ETH</p>
        </div>

        {/* Supply */}
        <div className="card">
          <div className="card-title">Collection Status</div>
          <div className="supply-big">{totalSupply}</div>
          <div className="supply-sub">of 100 tokens minted</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Wallet */}
        <div className="card">
          <div className="card-title">Identity</div>
          {!address ? (
            <button className="btn btn-outline" onClick={connectWallet}>
              [ CONNECT WALLET ]
            </button>
          ) : (
            <>
              <p className="addr">
                <span className="hi">{address.slice(0, 6)}</span>
                {address.slice(6, -4)}
                <span className="hi">{address.slice(-4)}</span>
              </p>
              <span className={`badge ${isWhitelisted ? "yes" : "no"}`}>
                {isWhitelisted ? "✓ WHITELISTED" : "✗ NOT WHITELISTED"}
              </span>
            </>
          )}
        </div>

        {/* Mint */}
        {address && (
          <div className="card">
            <div className="card-title">Mint Token</div>
            <div className="price-row">
              <span>MINT_PRICE</span>
              <span className="price-val">0.0001 ETH</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={mint}
              disabled={loading || !isWhitelisted || totalSupply >= 100}
            >
              {loading ? "[ PROCESSING... ]" : totalSupply >= 100 ? "[ SOLD OUT ]" : "[ ENTER THE MATRIX ]"}
            </button>
          </div>
        )}

        {/* Owner */}
        {isOwner && (
          <div className="card">
            <span className="owner-tag">⚠ ROOT ACCESS GRANTED</span>

            <div className="card-title">Whitelist Agent</div>
            <input
              className="input"
              type="text"
              placeholder="0x000000000000000000..."
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
            />
            <button className="btn btn-outline" onClick={addToWhitelist} disabled={loading}>
              [ ADD TO WHITELIST ]
            </button>

            <div className="divider" />

            <div className="card-title">Treasury</div>
            <button className="btn btn-red" onClick={withdraw} disabled={loading}>
              [ EXTRACT FUNDS ]
            </button>
          </div>
        )}

        {/* Status */}
        {status && (
          <div className={`status ${statusType}`}>
            <Typewriter text={status} speed={25} />
          </div>
        )}
      </div>
    </>
  );
}
