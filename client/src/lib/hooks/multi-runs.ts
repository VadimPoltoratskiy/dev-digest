/* hooks/multi-runs.ts — TanStack Query hooks for the multi-agent review feature (SPEC-03).
   Phase 4 (results page) and Phase 5 (configure run page) import from this file. */
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchAgentEstimates,
  fetchMultiRun,
  fetchMultiRunFindings,
  fetchMultiRuns,
  triggerMultiReview,
} from "../api";
import type { AgentEstimate, MultiRunFindings, MultiRunRecord, MultiRunSummaryList } from "@devdigest/shared";

/**
 * Per-agent time/cost estimates for the PR-page dropdown and Configure Run page.
 * Pass `prId = null` to skip the request (lazy-fetch-on-open pattern — INSIGHTS).
 */
export function useAgentEstimates(prId: string | null) {
  return useQuery<AgentEstimate[]>({
    queryKey: ["agent-estimates", prId],
    queryFn: () => fetchAgentEstimates(prId!),
    enabled: !!prId,
  });
}

/** Trigger a multi-agent review for a PR. */
export function useRunMultiReview() {
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      triggerMultiReview(prId, agentIds),
  });
}

/**
 * Aggregate status record for a multi-agent run.
 * Pass `multiRunId = null` to disable (e.g. before the run ID is known).
 */
export function useMultiRun(multiRunId: string | null) {
  return useQuery<MultiRunRecord>({
    queryKey: ["multi-run", multiRunId],
    queryFn: () => fetchMultiRun(multiRunId!),
    enabled: !!multiRunId,
  });
}

/**
 * Per-agent findings and cross-agent finding groups for a multi-run.
 * Pass `multiRunId = null` to disable.
 */
export function useMultiRunFindings(multiRunId: string | null) {
  return useQuery<MultiRunFindings>({
    queryKey: ["multi-run-findings", multiRunId],
    queryFn: () => fetchMultiRunFindings(multiRunId!),
    enabled: !!multiRunId,
  });
}

/**
 * Paginated multi-agent run history for a repo.
 * Pass `repoId = null` to disable (lazy-fetch-on-active-repo pattern).
 */
export function useMultiRuns(
  repoId: string | null,
  { limit, offset }: { limit: number; offset: number },
) {
  return useQuery<MultiRunSummaryList>({
    queryKey: ["multi-runs", repoId, limit, offset],
    queryFn: () => fetchMultiRuns(repoId!, limit, offset),
    enabled: !!repoId,
  });
}
