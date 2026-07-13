import type { CSSProperties } from "react";

export const s = {
  scroll: {
    overflowX: "auto",
    display: "flex",
    gap: 16,
    paddingBottom: 12,
  } satisfies CSSProperties,

  column: {
    minWidth: 280,
    maxWidth: 340,
    flex: "0 0 auto",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  colHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  } satisfies CSSProperties,

  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,

  statusText: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  statusRunning: {
    fontSize: 12,
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  statusFailed: {
    fontSize: 12,
    color: "var(--error)",
  } satisfies CSSProperties,

  spinner: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    border: "2px solid var(--accent-text)",
    borderTopColor: "transparent",
    animation: "spin 0.7s linear infinite",
    marginRight: 5,
  } satisfies CSSProperties,

  score: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  meta: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  findingList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: 1,
  } satisfies CSSProperties,

  findingItem: {
    fontSize: 12,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "4px 6px",
    borderRadius: 4,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,

  viewTraceBtn: {
    marginTop: "auto",
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text-secondary)",
    textAlign: "center" as const,
  } satisfies CSSProperties,
} as const;
