import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  summary: {
    color: "var(--text-primary)",
    fontStyle: "italic",
    lineHeight: 1.5,
    flex: 1,
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
    marginTop: 12,
  } satisfies CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties as CSSProperties,
  columnLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  bullet: {
    flexShrink: 0,
    marginTop: 2,
  } satisfies CSSProperties,
  footer: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-tertiary)",
    display: "flex",
    gap: 8,
    alignItems: "center",
  } satisfies CSSProperties,
  recalcBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
