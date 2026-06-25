/* RunCostBadge — cost display in two variants:
   "inline" → compact mono text for PR list column and timeline rows
   "stat"   → tile matching the Duration/Tokens/Findings stat style for the trace drawer */
import React from "react";

export function formatCost(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 0.001) return `$${v.toFixed(4)}`;
  if (v < 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

const statTile: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 7,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
};
const statLabel: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 };
const statVal: React.CSSProperties = { fontSize: 16, fontWeight: 700, marginTop: 4 };

export function RunCostBadge({
  costUsd,
  variant,
  label = "COST",
}: {
  costUsd: number | null | undefined;
  variant: "inline" | "stat";
  label?: string;
}) {
  const text = formatCost(costUsd);
  if (variant === "stat") {
    return (
      <div style={statTile}>
        <div style={statLabel}>{label}</div>
        <div className="tnum" style={statVal}>{text}</div>
      </div>
    );
  }
  return (
    <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
      {text}
    </span>
  );
}
