import type { CSSProperties } from "react";

/** Co-located styles for MultiRunHistoryView. */
export const s = {
  page: {
    padding: "24px 32px",
    maxWidth: 960,
    margin: "0 auto",
  } satisfies CSSProperties,

  headingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  } satisfies CSSProperties,

  heading: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  configureBtn: {
    padding: "9px 20px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: "var(--accent)",
    color: "#fff",
  } satisfies CSSProperties,

  selectSmall: {
    display: "block",
    width: "auto",
    padding: "6px 10px",
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    marginBottom: 16,
  } satisfies CSSProperties,

  tableCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  headRow: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.5fr",
    gap: 14,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
  } satisfies CSSProperties,

  headCell: {} as CSSProperties,

  dataRow: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.5fr",
    gap: 14,
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    transition: "background .1s",
  } satisfies CSSProperties,

  dataCell: {
    fontSize: 14,
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  loadMoreBtn: {
    display: "block",
    margin: "16px auto",
    padding: "8px 24px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid var(--border)",
    cursor: "pointer",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  emptyWrap: {
    padding: "48px 32px",
    textAlign: "center" as const,
  } satisfies CSSProperties,

  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 8,
  } satisfies CSSProperties,

  emptyBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,

  emptyBtn: {
    padding: "8px 20px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: "var(--accent)",
    color: "#fff",
  } satisfies CSSProperties,

  loadingWrap: {
    padding: "48px 32px",
    textAlign: "center" as const,
    color: "var(--text-muted)",
    fontSize: 14,
  } satisfies CSSProperties,

  errorWrap: {
    padding: "48px 32px",
    textAlign: "center" as const,
  } satisfies CSSProperties,

  errorTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 8,
  } satisfies CSSProperties,

  errorBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
