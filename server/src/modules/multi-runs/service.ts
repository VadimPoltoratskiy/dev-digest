import type { Container } from '../../platform/container.js';
import type { AgentEstimate, MultiRunRecord, MultiRunFindings, FindingRecord, MultiRunSummary, MultiRunSummaryList } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewService } from '../reviews/service.js';
import type { Logger } from '../reviews/run-executor.js';
import { MultiRunsRepository } from './repository.js';
import { groupFindingsByFileAndOverlap } from './helpers.js';

/**
 * MultiRunsService — business logic for multi-agent review runs.
 *
 * Orchestrates:
 *   - createMultiRun: validate PR + agents → insert multi_agent_runs row →
 *       delegate to ReviewService.runReview with multiRunId FK
 *   - getMultiRun:  load multi-run header + per-agent summaries; compute totals
 *   - getEstimates: per-agent time/cost estimates from historical agent_runs
 *   - getFindings:  group findings across agents by file + overlapping line range
 *
 * No HTTP concepts (no req/reply). No raw DB queries (delegated to repository).
 */
export class MultiRunsService {
  private repo: MultiRunsRepository;
  private reviewService: ReviewService;

  constructor(private container: Container) {
    this.repo = new MultiRunsRepository(container.db);
    this.reviewService = new ReviewService(container);
  }

  // ---------------------------------------------------------------------------
  // POST /pulls/:id/multi-review
  // ---------------------------------------------------------------------------

  /**
   * Create a multi-agent run:
   *   1. Validate PR exists in workspace.
   *   2. Resolve + validate all requested agents (must all belong to workspace).
   *   3. Insert a multi_agent_runs row.
   *   4. Kick off ReviewService.runReview for all agents (fire-and-forget).
   *   5. Return the multi_run_id and per-agent run stubs.
   */
  async createMultiRun(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{ multi_run_id: string; runs: { run_id: string; agent_id: string; agent_name: string }[] }> {
    // Deduplicate agentIds before resolution to prevent the same agent from
    // being run multiple times in one batch (cost/compute DoS mitigation).
    const uniqueAgentIds = [...new Set(agentIds)];

    // Step 1: Validate PR (use ReviewRepository exposed via container)
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Step 2: Resolve agents (workspace-scoped)
    const agentResults = await Promise.all(
      uniqueAgentIds.map((id) => this.container.agentsRepo.getById(workspaceId, id)),
    );
    if (agentResults.some((a) => a === undefined)) {
      throw new AppError('agent_not_found', 'One or more agent IDs not found in this workspace', 422);
    }
    const agents = agentResults as AgentRow[];

    // Step 3: Insert multi-run anchor row
    const multiRunId = await this.repo.insertMultiRun({ workspaceId, prId });

    // Step 4: Kick off reviews (ReviewService handles agent_run row creation,
    // SSE bus, executor fan-out). We pass the multiRunId so each agent_runs row
    // gets the FK set. The HTTP response returns before the reviews complete.
    const { runs } = await this.reviewService.runReview(
      workspaceId,
      prId,
      agents,
      logger,
      { multiRunId },
    );

    return { multi_run_id: multiRunId, runs };
  }

  // ---------------------------------------------------------------------------
  // GET /multi-runs/:id
  // ---------------------------------------------------------------------------

  /**
   * Return the multi-run header + per-agent status summary.
   * Computes total_cost_usd and total_duration_ms in JS from agent_runs rows.
   */
  async getMultiRun(workspaceId: string, multiRunId: string): Promise<MultiRunRecord> {
    const row = await this.repo.findMultiRunById(workspaceId, multiRunId);
    if (!row) throw new NotFoundError('Multi-agent run not found');

    const agentRuns = await this.repo.getAgentRunsByMultiRunId(multiRunId);

    // Sum cost (string→float) and duration only for rows that have them
    let totalCostUsd: number | null = null;
    let totalDurationMs: number | null = null;

    for (const ar of agentRuns) {
      if (ar.costUsd !== null) {
        const parsed = parseFloat(ar.costUsd);
        if (!isNaN(parsed)) {
          totalCostUsd = (totalCostUsd ?? 0) + parsed;
        }
      }
      if (ar.durationMs !== null) {
        totalDurationMs = (totalDurationMs ?? 0) + ar.durationMs;
      }
    }

    return {
      id: row.id,
      pr_id: row.prId,
      pr_number: row.prNumber ?? null,
      pr_title: row.prTitle ?? null,
      ran_at: row.ranAt.toISOString(),
      agents: agentRuns.map((ar) => ({
        run_id: ar.id,
        agent_id: ar.agentId,
        agent_name: ar.agentName,
        status: (ar.status ?? 'running') as 'running' | 'done' | 'failed' | 'cancelled',
        score: ar.score,
        finding_count: ar.findingsCount,
        cost_usd: ar.costUsd !== null ? parseFloat(ar.costUsd) : undefined,
        duration_ms: ar.durationMs ?? undefined,
        error: ar.error,
      })),
      total_cost_usd: totalCostUsd,
      total_duration_ms: totalDurationMs,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /pulls/:id/agents/estimates
  // ---------------------------------------------------------------------------

  /**
   * Per-agent estimates for the Configure Run page.
   * Fetches all enabled agents, then computes avg cost/duration over their last
   * 10 completed runs (queried in one IN-query, grouped in JS).
   */
  async getEstimates(workspaceId: string, _prId: string): Promise<AgentEstimate[]> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    if (agents.length === 0) return [];

    const agentIds = agents.map((a) => a.id);

    // Fetch historical rows + last finding summaries concurrently
    const [historyRows, summaryRows] = await Promise.all([
      this.repo.getLastNRunsPerAgent(workspaceId, agentIds),
      this.repo.getLastFindingSummaryPerAgent(workspaceId, agentIds),
    ]);

    // Group history rows by agentId using a Map
    const historyMap = new Map<string, { costUsd: string | null; durationMs: number | null }[]>();
    for (const r of historyRows) {
      const existing = historyMap.get(r.agentId);
      if (!existing) {
        historyMap.set(r.agentId, [r]);
      } else if (existing.length < 10) {
        // Rows are already ordered DESC by ran_at; take up to 10 per agent
        existing.push(r);
      }
    }

    return agents.map((agent) => {
      const rows = historyMap.get(agent.id) ?? [];
      const hasHistoricalData = rows.length > 0;

      let estimatedDurationMs: number | null = null;
      let estimatedCostUsd: number | null = null;

      if (hasHistoricalData) {
        const durRows = rows.filter((r) => r.durationMs !== null);
        if (durRows.length > 0) {
          estimatedDurationMs = Math.round(
            durRows.reduce((sum, r) => sum + r.durationMs!, 0) / durRows.length,
          );
        }

        const costRows = rows.filter((r) => r.costUsd !== null);
        if (costRows.length > 0) {
          estimatedCostUsd =
            costRows.reduce((sum, r) => sum + parseFloat(r.costUsd!), 0) / costRows.length;
        }
      }

      // The summary rows are ordered DESC; find the first (most recent) for this agent
      const summaryRow = summaryRows.find((r) => r.agentId === agent.id);

      return {
        agent_id: agent.id,
        agent_name: agent.name,
        estimated_duration_ms: estimatedDurationMs,
        estimated_cost_usd: estimatedCostUsd,
        last_finding_summary: summaryRow?.summary ?? null,
        has_historical_data: hasHistoricalData,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // GET /multi-runs
  // ---------------------------------------------------------------------------

  /**
   * Paginated list of multi-runs for a workspace + repo.
   * Aggregates per-run status, cost, and duration from child agent_runs in
   * one batch query (no N+1 — same pattern as pulls/routes.ts costByPr block).
   */
  async listMultiRuns(
    workspaceId: string,
    repoId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<MultiRunSummaryList> {
    const rows = await this.repo.findMultiRuns(workspaceId, repoId, { limit, offset });
    if (rows.length === 0) return { items: [], total: 0 };

    // COUNT(*) OVER() returns a bigint string from Postgres — coerce explicitly.
    const total = Number(rows[0]!.total);
    const multiRunIds = rows.map((r) => r.id);

    // Batch-fetch all child agent_runs (one round-trip, no N+1).
    const agentRunRows = await this.repo.getAgentRunsForMultiRunIds(multiRunIds);

    // Group by multiRunId in JS (same pattern as pulls/routes.ts costByPr block).
    type AgentRunMini = { status: string | null; costUsd: string | null; durationMs: number | null };
    const agentRunsMap = new Map<string, AgentRunMini[]>();
    for (const ar of agentRunRows) {
      if (!ar.multiRunId) continue; // null cannot occur given inArray filter
      const list = agentRunsMap.get(ar.multiRunId) ?? [];
      list.push(ar);
      agentRunsMap.set(ar.multiRunId, list);
    }

    const items: MultiRunSummary[] = rows.map((row) => {
      const childRuns = agentRunsMap.get(row.id) ?? [];

      // Status: running > failed > done. Zero child runs = still setting up => running.
      let status: 'running' | 'done' | 'failed';
      if (childRuns.length === 0 || childRuns.some((r) => !r.status || r.status === 'running')) {
        status = 'running';
      } else if (childRuns.some((r) => r.status === 'failed')) {
        status = 'failed';
      } else {
        status = 'done';
      }

      // Sum cost and duration (mirrors getMultiRun aggregation at service.ts:98-111).
      let totalCostUsd: number | null = null;
      let totalDurationMs: number | null = null;
      for (const ar of childRuns) {
        if (ar.costUsd !== null) {
          const parsed = parseFloat(ar.costUsd);
          if (!isNaN(parsed)) totalCostUsd = (totalCostUsd ?? 0) + parsed;
        }
        if (ar.durationMs !== null) {
          totalDurationMs = (totalDurationMs ?? 0) + ar.durationMs;
        }
      }

      return {
        id: row.id,
        pr_id: row.prId,
        pr_number: row.prNumber ?? null,
        pr_title: row.prTitle ?? null,
        ran_at: row.ranAt.toISOString(),
        agent_count: childRuns.length,
        status,
        total_cost_usd: totalCostUsd,
        total_duration_ms: totalDurationMs,
      };
    });

    return { items, total };
  }

  // ---------------------------------------------------------------------------
  // GET /multi-runs/:id/findings
  // ---------------------------------------------------------------------------

  /**
   * Fetch and group findings for a multi-run.
   * Returns per-agent flat lists plus cross-agent groups by file + overlapping
   * line range (via pure groupFindingsByFileAndOverlap helper).
   */
  async getFindings(workspaceId: string, multiRunId: string): Promise<MultiRunFindings> {
    // Workspace-scoped existence check
    const multiRun = await this.repo.findMultiRunById(workspaceId, multiRunId);
    if (!multiRun) throw new NotFoundError('Multi-agent run not found');

    const agentRuns = await this.repo.getAgentRunsByMultiRunId(multiRunId);
    const agentRunIds = agentRuns.map((r) => r.id);

    // Fetch flat (review + finding) rows for all agent_run IDs
    const rows = await this.repo.getReviewsAndFindingsByAgentRunIds(agentRunIds);

    // Build allAgents list (unique agent identity per agentRun, preserving FK-null edge case)
    const allAgents = agentRuns.map((ar) => ({
      agentId: ar.agentId,
      agentName: ar.agentName,
    }));

    // Map FindingRow → FindingRecord (snake_case API format).
    // The DB schema stores enum fields as plain text; cast them to the union
    // literal types declared in FindingRecord (values are trusted: they were
    // Zod-validated at insert time).
    function toFindingRecord(f: NonNullable<(typeof rows)[number]['finding']>): FindingRecord {
      return {
        id: f.id,
        severity: f.severity as FindingRecord['severity'],
        category: f.category as FindingRecord['category'],
        title: f.title,
        file: f.file,
        start_line: f.startLine,
        end_line: f.endLine,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: (f.kind as FindingRecord['kind']) ?? null,
        trifecta_components: (f.trifectaComponents as FindingRecord['trifecta_components']) ?? null,
        review_id: f.reviewId,
        accepted_at: f.acceptedAt ? f.acceptedAt.toISOString() : null,
        dismissed_at: f.dismissedAt ? f.dismissedAt.toISOString() : null,
      };
    }

    const allAgentFindings: { agentId: string | null; agentName: string | null; finding: FindingRecord }[] = [];

    for (const row of rows) {
      if (!row.finding) continue;
      allAgentFindings.push({
        agentId: row.agentId,
        agentName: row.agentName,
        finding: toFindingRecord(row.finding),
      });
    }

    // Build per-agent flat findings for the `agents` array in the response
    const perAgentMap = new Map<string, { agentId: string | null; agentName: string | null; findings: FindingRecord[] }>();
    for (const ar of agentRuns) {
      perAgentMap.set(ar.id, { agentId: ar.agentId, agentName: ar.agentName, findings: [] });
    }
    for (const row of rows) {
      if (!row.finding) continue;
      const entry = perAgentMap.get(row.agentRunId);
      if (entry) {
        entry.findings.push(toFindingRecord(row.finding));
      }
    }

    const agentsFindings = Array.from(perAgentMap.values()).map((e) => ({
      agent_id: e.agentId,
      agent_name: e.agentName,
      findings: e.findings,
    }));

    const groups = groupFindingsByFileAndOverlap(allAgentFindings, allAgents);

    return { agents: agentsFindings, groups };
  }
}
