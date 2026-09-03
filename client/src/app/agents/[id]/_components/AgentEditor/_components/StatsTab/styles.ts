import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 800 } satisfies CSSProperties,
  periodBar: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    flexWrap: "wrap" as const,
    alignItems: "center",
  } satisfies CSSProperties,
  presetBtn: (active: boolean): CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 5,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  }),
  dateLabel: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  applyBtn: {
    padding: "4px 12px",
    borderRadius: 5,
    border: "1px solid var(--accent)",
    background: "var(--accent)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  } satisfies CSSProperties,
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: 10,
    textTransform: "uppercase" as const,
  } satisfies CSSProperties,
  emptyText: {
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  skeletonCol: { display: "flex", flexDirection: "column" as const, gap: 12 } satisfies CSSProperties,
  skeletonRow: { display: "flex", gap: 12 } satisfies CSSProperties,
} as const;
