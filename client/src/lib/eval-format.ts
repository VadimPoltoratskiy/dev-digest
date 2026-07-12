/* eval-format.ts — shared formatting helpers for eval metrics/cost, used by
   the workspace/per-agent eval dashboards and the Agent Editor's Evals tab.
   `na`/`empty` strings are passed in by callers so this stays i18n-agnostic. */

export function fmtMetric(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtDelta(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  const pct = (v * 100).toFixed(1);
  return v >= 0 ? `+${pct}%` : `${pct}%`;
}

export function fmtCost(v: number | null | undefined, empty: string): string {
  if (v == null) return empty;
  return `$${v.toFixed(4)}`;
}

export function fmtCostDelta(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  if (v >= 0) return `+$${v.toFixed(4)}`;
  return `-$${Math.abs(v).toFixed(4)}`;
}
