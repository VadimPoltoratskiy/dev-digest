import type { CSSProperties } from "react";

export const s = {
  section: {
    marginTop: 24,
    borderTop: "1px solid var(--border)",
    paddingTop: 20,
  } satisfies CSSProperties,

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,

  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,

  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,

  toggleSwitch: {
    appearance: "none",
    width: 32,
    height: 18,
    borderRadius: 10,
    background: "var(--border)",
    cursor: "pointer",
    position: "relative",
    flexShrink: 0,
  } satisfies CSSProperties,

  emptyNote: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 0",
  } satisfies CSSProperties,

  groupList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,

  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,

  groupHeader: {
    padding: "8px 12px",
    background: "var(--bg-elevated)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  verdictList: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  verdictRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,

  verdictLastRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 12px",
    fontSize: 13,
  } satisfies CSSProperties,

  agentNameCell: {
    width: 140,
    fontWeight: 500,
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,

  findingCell: {
    flex: 1,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  didNotFlag: {
    flex: 1,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
} as const;
