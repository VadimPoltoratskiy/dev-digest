import type { CSSProperties } from "react";

/** Co-located styles for the AgentEditor shell. */
export const s = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 } satisfies CSSProperties,
  tabsBar: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  tabsBarActions: { display: "flex", alignItems: "center", gap: 8, paddingRight: 24 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
