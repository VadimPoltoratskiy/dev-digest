/* helpers.ts — pure aggregate estimate functions for the Configure Run page. */

import type { AgentEstimate } from "@devdigest/shared";

/**
 * Returns the max(estimated_duration_ms) across the selected agents assuming
 * parallel execution. Returns null when all selected agents have null duration
 * or selectedIds is empty.
 */
export function computeAggregateDuration(
  estimates: AgentEstimate[],
  selectedIds: string[],
): number | null {
  if (selectedIds.length === 0) return null;
  const values = estimates
    .filter((e) => selectedIds.includes(e.agent_id))
    .map((e) => e.estimated_duration_ms)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Returns the sum(estimated_cost_usd) across the selected agents.
 * Returns null when all selected agents have null cost or selectedIds is empty.
 */
export function computeAggregateCost(
  estimates: AgentEstimate[],
  selectedIds: string[],
): number | null {
  if (selectedIds.length === 0) return null;
  const values = estimates
    .filter((e) => selectedIds.includes(e.agent_id))
    .map((e) => e.estimated_cost_usd)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0);
}
