import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

/**
 * Multi-runs data-access. Plain functions over `Db` — no business logic.
 * All business logic and DTO mapping lives in MultiRunsService.
 */

// ---------------------------------------------------------------------------
// multi_agent_runs
// ---------------------------------------------------------------------------

/**
 * Insert a row into `multi_agent_runs`. Returns the new row's `id`.
 */
export async function insertMultiRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/**
 * Find a multi_agent_runs row by `id` and `workspaceId`.
 * LEFT JOINs pull_requests to get the PR number.
 * Returns `undefined` when not found in this workspace.
 */
export async function findMultiRunById(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<{ id: string; prId: string; prNumber: number | null; prTitle: string | null; ranAt: Date } | undefined> {
  const [row] = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
      ranAt: t.multiAgentRuns.ranAt,
    })
    .from(t.multiAgentRuns)
    .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(
        eq(t.multiAgentRuns.id, multiRunId),
        eq(t.multiAgentRuns.workspaceId, workspaceId),
      ),
    );
  if (!row) return undefined;
  return {
    id: row.id,
    prId: row.prId,
    prNumber: row.prNumber ?? null,
    prTitle: row.prTitle ?? null,
    ranAt: row.ranAt,
  };
}

// ---------------------------------------------------------------------------
// agent_runs
// ---------------------------------------------------------------------------

/** All agent_runs rows for a multi-run batch, joined with agents for the name. */
export async function getAgentRunsByMultiRunId(
  db: Db,
  multiRunId: string,
): Promise<
  {
    id: string;
    agentId: string | null;
    agentName: string | null;
    status: string | null;
    score: number | null;
    findingsCount: number | null;
    costUsd: string | null;
    durationMs: number | null;
    error: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      agentName: t.agents.name,
      status: t.agentRuns.status,
      score: t.agentRuns.score,
      findingsCount: t.agentRuns.findingsCount,
      costUsd: t.agentRuns.costUsd,
      durationMs: t.agentRuns.durationMs,
      error: t.agentRuns.error,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(eq(t.agentRuns.multiAgentRunId, multiRunId));

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    agentName: r.agentName ?? null,
    status: r.status,
    score: r.score,
    findingsCount: r.findingsCount,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    error: r.error,
  }));
}

/**
 * All completed (status='done') agent_run rows for the given agents in this
 * workspace, where both cost_usd and duration_ms are non-null, ordered by
 * ran_at DESC. The service layer groups by agentId in JS and slices to the
 * last 10 rows per agent to compute averages.
 */
export async function getLastNRunsPerAgent(
  db: Db,
  workspaceId: string,
  agentIds: string[],
): Promise<{ agentId: string; costUsd: string | null; durationMs: number | null }[]> {
  if (agentIds.length === 0) return [];
  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      costUsd: t.agentRuns.costUsd,
      durationMs: t.agentRuns.durationMs,
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.agentId, agentIds),
        eq(t.agentRuns.status, 'done'),
        isNotNull(t.agentRuns.costUsd),
        isNotNull(t.agentRuns.durationMs),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt));

  // agentId is string | null from the schema. We filtered by inArray(agentIds)
  // which excludes NULLs from the DB result, so cast to string is safe here.
  return rows.map((r) => ({
    agentId: r.agentId as string,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
  }));
}

/**
 * For each agent in `agentIds`, returns the most recent `reviews.summary`
 * (via `reviews.run_id → agent_runs.id`). The service groups results by
 * agentId in JS to pick the latest per agent.
 *
 * Returns one row per distinct (agentId, summary) pair, ordered by
 * agent_runs.ran_at DESC. The service takes `.find(r => r.agentId === id)`.
 */
export async function getLastFindingSummaryPerAgent(
  db: Db,
  workspaceId: string,
  agentIds: string[],
): Promise<{ agentId: string | null; summary: string | null }[]> {
  if (agentIds.length === 0) return [];
  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      summary: t.reviews.summary,
      ranAt: t.agentRuns.ranAt,
    })
    .from(t.reviews)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.agentId, agentIds),
        eq(t.reviews.kind, 'review'),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt));

  return rows.map((r) => ({
    agentId: r.agentId,
    summary: r.summary,
  }));
}

// ---------------------------------------------------------------------------
// reviews + findings (for multi-run findings grouping)
// ---------------------------------------------------------------------------

/**
 * For each agent_run in `agentRunIds`, fetch all reviews and their findings.
 * Results are returned as flat rows; the service groups by agentRunId in JS.
 */
export async function getReviewsAndFindingsByAgentRunIds(
  db: Db,
  agentRunIds: string[],
): Promise<
  {
    agentRunId: string;
    agentId: string | null;
    agentName: string | null;
    finding: FindingRow | null;
    reviewId: string;
  }[]
> {
  if (agentRunIds.length === 0) return [];

  const rows = await db
    .select({
      agentRunId: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      agentName: t.agents.name,
      // finding columns
      findingId: t.findings.id,
      findingReviewId: t.findings.reviewId,
      findingFile: t.findings.file,
      findingStartLine: t.findings.startLine,
      findingEndLine: t.findings.endLine,
      findingSeverity: t.findings.severity,
      findingCategory: t.findings.category,
      findingTitle: t.findings.title,
      findingRationale: t.findings.rationale,
      findingSuggestion: t.findings.suggestion,
      findingConfidence: t.findings.confidence,
      findingKind: t.findings.kind,
      findingTrifectaComponents: t.findings.trifectaComponents,
      findingAcceptedAt: t.findings.acceptedAt,
      findingDismissedAt: t.findings.dismissedAt,
      reviewId: t.reviews.id,
    })
    .from(t.reviews)
    .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
    .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(inArray(t.reviews.runId, agentRunIds));

  return rows.map((r) => {
    const finding: FindingRow | null = r.findingId
      ? {
          id: r.findingId,
          reviewId: r.findingReviewId!,
          file: r.findingFile!,
          startLine: r.findingStartLine!,
          endLine: r.findingEndLine!,
          severity: r.findingSeverity!,
          category: r.findingCategory!,
          title: r.findingTitle!,
          rationale: r.findingRationale!,
          suggestion: r.findingSuggestion ?? null,
          confidence: r.findingConfidence!,
          kind: r.findingKind!,
          trifectaComponents: (r.findingTrifectaComponents as string[] | null) ?? null,
          acceptedAt: r.findingAcceptedAt ?? null,
          dismissedAt: r.findingDismissedAt ?? null,
        }
      : null;

    return {
      agentRunId: r.agentRunId!,
      agentId: r.agentId,
      agentName: r.agentName ?? null,
      finding,
      reviewId: r.reviewId,
    };
  });
}

// ---------------------------------------------------------------------------
// Repository class wrapper (for DI pattern used by the service)
// ---------------------------------------------------------------------------

export class MultiRunsRepository {
  constructor(private db: Db) {}

  insertMultiRun(values: { workspaceId: string; prId: string }): Promise<string> {
    return insertMultiRun(this.db, values);
  }

  findMultiRunById(
    workspaceId: string,
    multiRunId: string,
  ): Promise<{ id: string; prId: string; prNumber: number | null; prTitle: string | null; ranAt: Date } | undefined> {
    return findMultiRunById(this.db, workspaceId, multiRunId);
  }

  getAgentRunsByMultiRunId(
    multiRunId: string,
  ): Promise<
    {
      id: string;
      agentId: string | null;
      agentName: string | null;
      status: string | null;
      score: number | null;
      findingsCount: number | null;
      costUsd: string | null;
      durationMs: number | null;
      error: string | null;
    }[]
  > {
    return getAgentRunsByMultiRunId(this.db, multiRunId);
  }

  getLastNRunsPerAgent(
    workspaceId: string,
    agentIds: string[],
  ): Promise<{ agentId: string; costUsd: string | null; durationMs: number | null }[]> {
    return getLastNRunsPerAgent(this.db, workspaceId, agentIds);
  }

  getLastFindingSummaryPerAgent(
    workspaceId: string,
    agentIds: string[],
  ): Promise<{ agentId: string | null; summary: string | null }[]> {
    return getLastFindingSummaryPerAgent(this.db, workspaceId, agentIds);
  }

  getReviewsAndFindingsByAgentRunIds(
    agentRunIds: string[],
  ): Promise<
    {
      agentRunId: string;
      agentId: string | null;
      agentName: string | null;
      finding: FindingRow | null;
      reviewId: string;
    }[]
  > {
    return getReviewsAndFindingsByAgentRunIds(this.db, agentRunIds);
  }
}
