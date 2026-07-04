import { z } from 'zod';

/**
 * Local subset of DevDigest's shared Zod contracts (server/src/vendor/shared/contracts/).
 * Deliberately smaller than the originals — heavy/rarely-needed fields (system_prompt,
 * raw_output, evidence_snippet, ...) are omitted here rather than fetched and discarded,
 * so tool output stays cheap. Kept in sync with the server contracts by convention, not
 * by a compile-time import (this package has no path alias into server/).
 */

export const RepoItem = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
});
export type RepoItem = z.infer<typeof RepoItem>;

export const PullItem = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
});
export type PullItem = z.infer<typeof PullItem>;

export const AgentSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  strategy: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const RunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type RunTarget = z.infer<typeof RunTarget>;

/** Subset of the server's RunSummary (server/src/vendor/shared/contracts/trace.ts). */
export const RunStatus = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.string().nullable(),
  error: z.string().nullable(),
  score: z.number().int().nullable(),
  findings_count: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  cost_usd: z.number().nullable(),
});
export type RunStatus = z.infer<typeof RunStatus>;

/** Subset of the server's FindingRecord (server/src/vendor/shared/contracts/review-api.ts). */
export const FindingSummary = z.object({
  id: z.string(),
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.enum(['bug', 'security', 'perf', 'style', 'test']),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
});
export type FindingSummary = z.infer<typeof FindingSummary>;

/** Subset of the server's ReviewRecord — just enough to attribute findings to a run. */
export const ReviewRecordLite = z.object({
  run_id: z.string().nullable(),
  findings: z.array(FindingSummary),
});
export type ReviewRecordLite = z.infer<typeof ReviewRecordLite>;

export const ConventionItem = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  confidence: z.number(),
  accepted: z.boolean(),
});
export type ConventionItem = z.infer<typeof ConventionItem>;

/** Error envelope the server returns on non-2xx responses (ApiErrorBody). */
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
