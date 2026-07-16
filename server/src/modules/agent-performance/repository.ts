import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Agent Performance repository — shared aggregation layer for both
 * GET /agent-performance (dashboard) and GET /agents/:id/stats.
 *
 * All queries are workspace-scoped. Date comparisons use parameterized values
 * via gte/lte — never sql.raw() with user-provided input.
 */
export class AgentPerformanceRepository {
  constructor(private readonly db: Db) {}

  /**
   * Aggregate agent_runs per agentId (including null = deleted agent).
   * Returns one row per agentId with run counts, cost, duration, last run.
   *
   * costUsd is a numeric(12,8) column — Drizzle returns it as a JS string.
   * The service layer must parseFloat() all cost values.
   */
  async aggregateRunsByAgent(workspaceId: string, from: Date, to: Date) {
    return this.db
      .select({
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        runs: sql<number>`count(*)::int`,
        totalCostStr: sql<string | null>`SUM(${t.agentRuns.costUsd}) FILTER (WHERE ${t.agentRuns.costUsd} IS NOT NULL)`,
        countCost: sql<number>`COUNT(*) FILTER (WHERE ${t.agentRuns.costUsd} IS NOT NULL)`,
        sumDuration: sql<number | null>`SUM(${t.agentRuns.durationMs}) FILTER (WHERE ${t.agentRuns.durationMs} IS NOT NULL)`,
        countDuration: sql<number>`COUNT(*) FILTER (WHERE ${t.agentRuns.durationMs} IS NOT NULL)`,
        lastRunAt: sql<string | null>`MAX(${t.agentRuns.ranAt})`,
      })
      .from(t.agentRuns)
      .leftJoin(
        t.agents,
        and(
          eq(t.agentRuns.agentId, t.agents.id),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, from),
          lte(t.agentRuns.ranAt, to),
        ),
      )
      .groupBy(t.agentRuns.agentId, t.agents.name);
  }

  /**
   * Aggregate findings per (agentId, severity) via reviews.
   * LEFT JOINs agents to detect deleted-agent reviews (agentExists = null).
   *
   * Both `reviews.agentId IS NULL` and `reviews.agentId IS NOT NULL AND agentExists IS NULL`
   * → the service maps these to the null/deleted-agent bucket.
   */
  async aggregateFindingsByAgent(workspaceId: string, from: Date, to: Date) {
    return this.db
      .select({
        reviewAgentId: t.reviews.agentId,
        agentExists: t.agents.id,
        agentName: t.agents.name,
        severity: t.findings.severity,
        total: sql<number>`count(*)::int`,
        accepted: sql<number>`COUNT(*) FILTER (WHERE ${t.findings.acceptedAt} IS NOT NULL)`,
        dismissed: sql<number>`COUNT(*) FILTER (WHERE ${t.findings.dismissedAt} IS NOT NULL)`,
      })
      .from(t.reviews)
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .leftJoin(
        t.agents,
        and(
          eq(t.reviews.agentId, t.agents.id),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          gte(t.reviews.createdAt, from),
          lte(t.reviews.createdAt, to),
          eq(t.reviews.kind, 'review'),
        ),
      )
      .groupBy(t.reviews.agentId, t.agents.id, t.agents.name, t.findings.severity);
  }

  /**
   * Individual run rows for sparkline trend (oldest→newest).
   * If agentId is provided, filters to that agent only.
   * If agentId is null, returns all runs in the workspace+period.
   */
  async getRunTrend(workspaceId: string, agentId: string | null, from: Date, to: Date) {
    const conditions = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, from),
      lte(t.agentRuns.ranAt, to),
    ];
    if (agentId !== null) {
      conditions.push(eq(t.agentRuns.agentId, agentId));
    }

    return this.db
      .select({
        agentId: t.agentRuns.agentId,
        ranAt: t.agentRuns.ranAt,
        findingsCount: t.agentRuns.findingsCount,
      })
      .from(t.agentRuns)
      .where(and(...conditions))
      .orderBy(asc(t.agentRuns.ranAt));
  }

  /**
   * Daily run counts for the summary sparkline.
   * Groups all runs by UTC day, ordered chronologically.
   */
  async getDailyRunsTrend(workspaceId: string, from: Date, to: Date) {
    return this.db
      .select({
        day: sql<string>`DATE_TRUNC('day', ${t.agentRuns.ranAt} AT TIME ZONE 'UTC')::text`,
        runs: sql<number>`count(*)::int`,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, from),
          lte(t.agentRuns.ranAt, to),
        ),
      )
      .groupBy(sql`DATE_TRUNC('day', ${t.agentRuns.ranAt} AT TIME ZONE 'UTC')`)
      .orderBy(sql`DATE_TRUNC('day', ${t.agentRuns.ranAt} AT TIME ZONE 'UTC')`);
  }

  /**
   * Cost breakdown by model. Only includes models with non-null, non-zero cost.
   * Null model rows are grouped under 'unknown'.
   */
  async getModelCostBreakdown(workspaceId: string, from: Date, to: Date) {
    return this.db
      .select({
        model: sql<string>`COALESCE(${t.agentRuns.model}, 'unknown')`,
        totalCostStr: sql<string | null>`SUM(${t.agentRuns.costUsd}) FILTER (WHERE ${t.agentRuns.costUsd} IS NOT NULL)`,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, from),
          lte(t.agentRuns.ranAt, to),
        ),
      )
      .groupBy(sql`COALESCE(${t.agentRuns.model}, 'unknown')`);
  }
}
