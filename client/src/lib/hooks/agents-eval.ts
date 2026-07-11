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
  getEvalsDashboardAgents,
  getAgentEvalCases,
  postAgentEvalRuns,
  postFindingEvalCase,
} from "../api";
import { notify } from "../toast";

/** List all eval cases for an agent, including latest_run when available. */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-cases", agentId],
    queryFn: () => getAgentEvalCases(agentId!),
    enabled: !!agentId,
  });
}

/**
 * Mutation: turn a finding into an agent eval case with a caller-chosen kind.
 * Invalidates the created case's agent's case list and shows a success toast.
 * Errors surface via the app-wide MutationCache.onError (providers.tsx) — no
 * local onError here, or the failure would toast twice.
 */
export function useTurnFindingIntoEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      findingId: string;
      kind: "must_find" | "must_not_flag";
      name: string;
    }) => postFindingEvalCase(input.findingId, { kind: input.kind, name: input.name }),
    onSuccess: (evalCase) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", evalCase.agent_id] });
      notify.success(`Eval case "${evalCase.name}" created`);
    },
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

/** Fetch per-agent eval summaries for the workspace dashboard's agent list. */
export function useEvalsDashboardAgents() {
  return useQuery({
    queryKey: ["evals-dashboard-agents"],
    queryFn: () => getEvalsDashboardAgents(),
  });
}
