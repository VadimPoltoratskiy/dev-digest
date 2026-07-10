/* hooks/agents-eval.ts — TanStack Query hooks for the agent eval pipeline.
   Covers: eval case management, batch runs, run history, run comparison,
   and the global evals dashboard. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAgentEvalCase,
  getAgentEvalRuns,
  getAgentEvalRunsCompare,
  getEvalsDashboard,
  getAgentEvalCases,
  postAgentEvalRuns,
  postFindingEvalCase,
} from "../api";

/** List all eval cases for an agent, including latest_run when available. */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-cases", agentId],
    queryFn: () => getAgentEvalCases(agentId!),
    enabled: !!agentId,
  });
}

/**
 * Mutation: turn an accepted or dismissed finding into an agent eval case.
 * No automatic invalidation — the caller decides which query to refresh
 * (typically ["agent-eval-cases", agentId] for the relevant agent).
 */
export function useTurnFindingIntoEvalCase() {
  return useMutation({
    mutationFn: (findingId: string) => postFindingEvalCase(findingId),
  });
}

/** Mutation: delete an agent eval case; invalidates the case list on success. */
export function useDeleteAgentEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => deleteAgentEvalCase(agentId, caseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", agentId] });
    },
  });
}

/**
 * Mutation: run all eval cases for an agent as a single batch.
 * Can be slow (one LLM call per case). On success invalidates both the case
 * list (to refresh latest_run) and the run history.
 */
export function useRunAgentEvalBatch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postAgentEvalRuns(agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-runs", agentId] });
    },
  });
}

/** List all persisted eval run records for an agent. Client groups by ran_at. */
export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-runs", agentId],
    queryFn: () => getAgentEvalRuns(agentId!),
    enabled: !!agentId,
  });
}

/** Compare two batch runs for an agent by their ran_at ISO timestamp strings. */
export function useAgentEvalRunsCompare(
  agentId: string | null | undefined,
  a: string | null,
  b: string | null,
) {
  return useQuery({
    queryKey: ["agent-eval-compare", agentId, a, b],
    queryFn: () => getAgentEvalRunsCompare(agentId!, a!, b!),
    enabled: !!agentId && !!a && !!b,
  });
}

/** Fetch the workspace-level eval dashboard, optionally filtered by agent id. */
export function useEvalsDashboard(ownerId?: string) {
  return useQuery({
    queryKey: ["evals-dashboard", ownerId],
    queryFn: () => getEvalsDashboard(ownerId),
  });
}
