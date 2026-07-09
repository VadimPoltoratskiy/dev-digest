import type { CSSProperties } from "react";

export const s = {
  item: {
    listStyle: "none",
  } satisfies CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    fontSize: 14,
  } satisfies CSSProperties,
  bullet: {
    flexShrink: 0,
    marginTop: 2,
    color: "var(--text-tertiary)",
  } satisfies CSSProperties,
  path: {
    flexGrow: 1,
    wordBreak: "break-all" as const,
  } satisfies CSSProperties,
  chevron: {
    flexShrink: 0,
    fontSize: 10,
    color: "var(--text-tertiary)",
    marginTop: 2,
  } satisfies CSSProperties,
  expandLabel: {
    flexShrink: 0,
    fontSize: 11,
    color: "var(--accent, #60a5fa)",
    marginLeft: 4,
  } satisfies CSSProperties,
  panel: {
    marginTop: 6,
    marginLeft: 16,
    paddingLeft: 8,
    borderLeft: "2px solid var(--border)",
  } satisfies CSSProperties,
  loading: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,
  empty: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,
  priorPrsLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  priorList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  priorItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,
  priorLink: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    textDecoration: "none",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  priorNumber: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--accent, #60a5fa)",
    flexShrink: 0,
  } satisfies CSSProperties,
  priorTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,
  priorMeta: {
    fontSize: 11,
    color: "var(--text-tertiary)",
  } satisfies CSSProperties,
  truncation: {
    display: "block",
    marginTop: 4,
    fontSize: 11,
    color: "var(--text-tertiary)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,
} as const;
