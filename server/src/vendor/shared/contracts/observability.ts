import { z } from 'zod';
import { Severity } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;

// ---------------------------------------------------------------------------
// Multi-Run (SPEC-03) contracts
// ---------------------------------------------------------------------------

/** Body for POST /pulls/:id/multi-review. */
export const MultiReviewRequest = z.object({
  agentIds: z.array(z.string().uuid()).min(1).max(20),
});
export type MultiReviewRequest = z.infer<typeof MultiReviewRequest>;

/** Per-agent status entry within a multi-run result. */
export const AgentRunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  score: z.number().int().nullable(),
  finding_count: z.number().int().nullable(),
  /** .nullish() — rows written before cost tracking was added lack this field. */
  cost_usd: z.number().nullish(),
  duration_ms: z.number().int().nullish(),
  error: z.string().nullable(),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummary>;

/** Aggregate response for GET /multi-runs/:id. */
export const MultiRunRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  /** Joined from pulls table; nullish for forward compat. */
  pr_number: z.number().int().nullish(),
  /** Joined from pulls table; nullish for forward compat. */
  pr_title: z.string().nullish(),
  ran_at: z.string(),
  agents: z.array(AgentRunSummary),
  /** .nullable() — service always computes this from summing agent rows. */
  total_cost_usd: z.number().nullable(),
  total_duration_ms: z.number().int().nullable(),
});
export type MultiRunRecord = z.infer<typeof MultiRunRecord>;

/** Per-agent estimate for the Configure Run page. */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  estimated_duration_ms: z.number().int().nullable(),
  estimated_cost_usd: z.number().nullable(),
  last_finding_summary: z.string().nullable(),
  has_historical_data: z.boolean(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** One cross-agent finding group (file + overlapping line range). */
export const FindingGroup = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  agent_verdicts: z.array(
    z.object({
      agent_id: z.string().nullable(),
      agent_name: z.string().nullable(),
      /** null = "did not flag" */
      finding: FindingRecord.nullable(),
    }),
  ),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** Response for GET /multi-runs/:id/findings. */
export const MultiRunFindings = z.object({
  agents: z.array(
    z.object({
      agent_id: z.string().nullable(),
      agent_name: z.string().nullable(),
      findings: z.array(FindingRecord),
    }),
  ),
  groups: z.array(FindingGroup),
});
export type MultiRunFindings = z.infer<typeof MultiRunFindings>;
