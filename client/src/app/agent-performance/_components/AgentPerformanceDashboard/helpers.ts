/* helpers.ts — pure formatting helpers for the Agent Performance dashboard. */

/** Format a cost in USD. Returns "—" for null. */
export function formatCost(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Format a duration in milliseconds as a human-readable string. Returns "—" for null. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Format an accept rate (0–1) as a percentage string. Returns "—" for null. */
export function formatAcceptRate(r: number | null): string {
  if (r === null) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

/**
 * Compute the percentage delta between current and previous values.
 * Returns null when either value is null or previous is zero (AC-8 — no NaN/Infinity).
 */
export function computeDelta(
  current: number | null,
  prev: number | null,
): { pct: number; dir: "up" | "down" } | null {
  if (current === null || prev === null || prev === 0) return null;
  const raw = ((current - prev) / Math.abs(prev)) * 100;
  return { pct: Math.abs(raw), dir: raw >= 0 ? "up" : "down" };
}

/**
 * Format an ISO timestamp as relative time (e.g. "5m ago", "3h ago", "2d ago").
 * Returns "—" for null input.
 */
export function formatRelativeTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
