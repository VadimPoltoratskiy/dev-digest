import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingBottom: 18,
    borderBottom: "1px solid var(--border)",
    marginBottom: 18,
  } satisfies CSSProperties,

  topRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  breadcrumb: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  actions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,

  configLink: {
    fontSize: 13,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,

  toggle: {
    display: "flex",
    borderRadius: 6,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,

  toggleBtn: {
    padding: "5px 12px",
    fontSize: 13,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  toggleBtnActive: {
    padding: "5px 12px",
    fontSize: 13,
    background: "var(--accent-bg)",
    border: "none",
    cursor: "pointer",
    color: "var(--accent-text)",
    fontWeight: 600,
  } satisfies CSSProperties,

  summary: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
