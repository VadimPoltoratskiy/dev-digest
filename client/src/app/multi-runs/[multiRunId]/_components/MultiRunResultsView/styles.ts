import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 32px",
    maxWidth: 1200,
    margin: "0 auto",
  } satisfies CSSProperties,

  loadingWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "32px 0",
  } satisfies CSSProperties,

  errorWrap: {
    padding: "24px 0",
    color: "var(--error)",
    fontSize: 14,
  } satisfies CSSProperties,

  retryBtn: {
    marginTop: 10,
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
