import type { CSSProperties } from "react";

export const s = {
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 0",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    background: "var(--bg-base)",
  } satisfies CSSProperties,
  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,
  sha: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  author: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  date: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginLeft: "auto",
  } satisfies CSSProperties,
  summaryText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  blameBadge: {
    display: "inline-block",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    background: "var(--accent-bg, #0a2a4a)",
    color: "var(--accent, #60a5fa)",
    border: "1px solid var(--accent, #60a5fa)",
  } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
    marginTop: 8,
    marginBottom: 4,
  } satisfies CSSProperties,
  rationale: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  riskItem: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    margin: 0,
  } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginRight: 6,
  } satisfies CSSProperties,
  badgeLow: {
    background: "var(--ok-bg, #052e1c)",
    color: "var(--ok, #3dd68c)",
    border: "1px solid var(--ok, #3dd68c)",
  } satisfies CSSProperties,
  badgeMedium: {
    background: "var(--warn-bg, #2e1c05)",
    color: "var(--warn, #f5a623)",
    border: "1px solid var(--warn, #f5a623)",
  } satisfies CSSProperties,
  badgeHigh: {
    background: "var(--crit-bg, #2e0a0a)",
    color: "var(--crit, #f87171)",
    border: "1px solid var(--crit, #f87171)",
  } satisfies CSSProperties,
  prLink: {
    fontSize: 12,
    color: "var(--accent, #60a5fa)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
