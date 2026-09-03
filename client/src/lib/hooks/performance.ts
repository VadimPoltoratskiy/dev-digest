/* hooks/performance.ts — TanStack Query hooks for agent performance analytics. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAgentStats, fetchAgentPerformance } from "../api";
import type { AgentStats, AgentPerformance } from "@devdigest/shared";

type PeriodParams = { period?: string; from?: string; to?: string };

/**
 * Fetch per-agent quality stats for the Stats tab (GET /agents/:id/stats).
 * Disabled when agentId is null. Params are included in the query key so
 * changing the period auto-invalidates and re-fetches (AC-4).
 */
export function useAgentStats(agentId: string | null, params: PeriodParams = {}) {
  return useQuery<AgentStats>({
    queryKey: ["agent-stats", agentId, params],
    queryFn: () => fetchAgentStats(agentId!, params),
    enabled: !!agentId,
  });
}

/**
 * Fetch the workspace-level agent performance dashboard (GET /agent-performance).
 * Params are included in the query key so changing the period auto-invalidates
 * and re-fetches (AC-4).
 */
export function useAgentPerformance(params: PeriodParams = {}) {
  return useQuery<AgentPerformance>({
    queryKey: ["agent-performance", params],
    queryFn: () => fetchAgentPerformance(params),
  });
}
