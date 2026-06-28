import type { CSSProperties } from "react";

export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 800, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  } satisfies CSSProperties,
  back: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-secondary)",
    fontSize: 14,
    padding: 0,
  } satisfies CSSProperties,
  h2: { fontSize: 20, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  form: { display: "flex", flexDirection: "column", gap: 0 } satisfies CSSProperties,
  actions: { marginTop: 16, display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  savedNote: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
