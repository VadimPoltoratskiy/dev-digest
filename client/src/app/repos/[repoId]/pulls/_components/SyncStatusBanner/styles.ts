import type { CSSProperties } from "react";

/** Co-located styles for the stale-sync warning banner. */
export const s = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    marginBottom: 14,
    borderRadius: 8,
    border: "1px solid var(--warning, #b45309)",
    background: "color-mix(in srgb, var(--warning, #b45309) 12%, transparent)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } as CSSProperties,
  bannerText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flex: 1,
  } as CSSProperties,
  bannerReason: {
    color: "var(--text-secondary)",
    fontSize: 11.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as CSSProperties,
  bannerDismiss: {
    display: "inline-flex",
    alignItems: "center",
    padding: 4,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: 4,
  } as CSSProperties,
};
