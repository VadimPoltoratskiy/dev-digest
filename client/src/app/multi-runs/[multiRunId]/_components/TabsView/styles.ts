import type { CSSProperties } from "react";

export const s = {
  tabBar: {
    display: "flex",
    gap: 0,
    borderBottom: "2px solid var(--border)",
    marginBottom: 18,
    overflowX: "auto",
  } satisfies CSSProperties,

  tab: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    marginBottom: -2,
    cursor: "pointer",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  tabActive: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    borderBottom: "2px solid var(--accent-text)",
    marginBottom: -2,
    cursor: "pointer",
    color: "var(--accent-text)",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  tabContent: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,

  summaryCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 14,
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  score: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  summaryText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    flex: 1,
  } satisfies CSSProperties,

  meta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  viewTraceBtn: {
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  statusRunning: {
    fontSize: 12,
    color: "var(--accent-text)",
    display: "flex",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,

  spinner: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    border: "2px solid var(--accent-text)",
    borderTopColor: "transparent",
    animation: "spin 0.7s linear infinite",
  } satisfies CSSProperties,
} as const;
