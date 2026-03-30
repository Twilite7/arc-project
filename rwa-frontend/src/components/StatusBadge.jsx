const STATUS = {
  0: { label: "Available", color: "var(--green)", bg: "rgba(45,106,79,0.08)" },
  1: { label: "In Escrow", color: "var(--gold)",  bg: "rgba(184,151,42,0.1)" },
  2: { label: "Sold",      color: "var(--mid)",   bg: "rgba(107,107,103,0.1)" },
};

export default function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS[0];
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px", borderRadius: 2,
      fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
      color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`,
    }}>{s.label}</span>
  );
}
