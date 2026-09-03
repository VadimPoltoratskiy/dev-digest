import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { PeriodParams } from '../_shared/schemas.js';
import type {
  AgentStats,
  AgentPerformance,
  AgentPerformanceRow,
  AgentCostBreakdown,
  ModelCostBreakdown,
  StatPoint,
} from '@devdigest/shared';
import { AgentPerformanceRepository } from './repository.js';

type RunsByAgentRow = Awaited<ReturnType<AgentPerformanceRepository['aggregateRunsByAgent']>>[number];
type FindingsByAgentRow = Awaited<ReturnType<AgentPerformanceRepository['aggregateFindingsByAgent']>>[number];
type RunTrendRow = Awaited<ReturnType<AgentPerformanceRepository['getRunTrend']>>[number];

interface ResolvedPeriod {
  from: Date;
  to: Date;
  preset: '30d' | '7d' | '1d' | 'custom' | null;
}

/**
 * Agent Performance service — shared aggregation for both
 * GET /agent-performance (dashboard) and GET /agents/:id/stats.
 */
export class AgentPerformanceService {
  private readonly repo: AgentPerformanceRepository;

  constructor(private readonly container: Container) {
    this.repo = new AgentPerformanceRepository(container.db);
  }

  // ---------------------------------------------------------------------------
  // Period resolution
  // ---------------------------------------------------------------------------

  resolvePeriod(params: PeriodParams): ResolvedPeriod {
    const now = new Date();
    const period = params.period ?? '30d';

    if (period === 'custom') {
      return {
        from: new Date(params.from! + 'T00:00:00.000Z'),
        to:   new Date(params.to!   + 'T23:59:59.999Z'),
        preset: 'custom',
      };
    }
    if (period === '7d') {
      return {
        from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        to:   now,
        preset: '7d',
      };
    }
    if (period === '1d') {
      return {
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        to:   now,
        preset: '1d',
      };
    }
    // default: 30d
    return {
      from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to:   now,
      preset: '30d',
    };
  }

  previousPeriod(current: { from: Date; to: Date }): { from: Date; to: Date } {
    const length = current.to.getTime() - current.from.getTime();
    return {
      from: new Date(current.from.getTime() - length),
      to:   new Date(current.from.getTime() - 1),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /agents/:id/stats
  // ---------------------------------------------------------------------------

  async getAgentStats(
    workspaceId: string,
    agentId: string,
    params: PeriodParams,
  ): Promise<AgentStats> {
    const { from, to } = this.resolvePeriod(params);

    const [runsRows, findingsRows, trendRows] = await Promise.all([
      this.repo.aggregateRunsByAgent(workspaceId, from, to),
      this.repo.aggregateFindingsByAgent(workspaceId, from, to),
      this.repo.getRunTrend(workspaceId, agentId, from, to),
    ]);

    // Verify the agent exists in this workspace
    const agentRunRow = runsRows.find((r) => r.agentId === agentId);
    // Even if there are no runs, we need to verify the agent belongs to the workspace.
    if (!agentRunRow) {
      const agentRow = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agentRow) {
        throw new NotFoundError('Agent not found');
      }
    }

    // Aggregate findings for this agent
    const agentFindings = findingsRows.filter((r) => {
      // Match by reviewAgentId = agentId AND agent was found (not deleted)
      return r.reviewAgentId === agentId && r.agentExists !== null;
    });

    const findingsTotal = agentFindings.reduce((s, r) => s + Number(r.total), 0);
    const accepted = agentFindings.reduce((s, r) => s + Number(r.accepted), 0);
    const dismissed = agentFindings.reduce((s, r) => s + Number(r.dismissed), 0);
    const pending = findingsTotal - accepted - dismissed;
    const acted = accepted + dismissed;
    const accept_rate = acted > 0 ? accepted / acted : null;
    const dismiss_rate = acted > 0 ? dismissed / acted : null;

    // Findings by severity
    const findings_by_severity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
    for (const r of agentFindings) {
      const sev = r.severity as keyof typeof findings_by_severity;
      if (sev in findings_by_severity) {
        findings_by_severity[sev] += Number(r.total);
      }
    }

    // Runs aggregation
    const runs = agentRunRow ? Number(agentRunRow.runs) : 0;
    const countCost = agentRunRow ? Number(agentRunRow.countCost) : 0;
    const totalCostUsd = agentRunRow?.totalCostStr != null
      ? parseFloat(agentRunRow.totalCostStr)
      : null;
    const avg_cost_usd = countCost > 0 && totalCostUsd !== null
      ? totalCostUsd / countCost
      : null;
    const countDuration = agentRunRow ? Number(agentRunRow.countDuration) : 0;
    const sumDuration = agentRunRow?.sumDuration != null
      ? Number(agentRunRow.sumDuration)
      : null;
    const avg_latency_ms = countDuration > 0 && sumDuration !== null
      ? sumDuration / countDuration
      : null;
    const avg_findings_per_run = runs > 0 ? findingsTotal / runs : null;

    // Trend: individual runs mapped to StatPoint
    const trend: StatPoint[] = trendRows.map((r) => ({
      label: r.ranAt instanceof Date ? r.ranAt.toISOString() : String(r.ranAt),
      value: r.findingsCount ?? 0,
    }));

    // Agent name: prefer from run row (LEFT JOIN), fallback to direct lookup
    let agentName: string | null = agentRunRow?.agentName ?? null;
    if (!agentName) {
      const agentRecord = await this.container.agentsRepo.getById(workspaceId, agentId);
      agentName = agentRecord?.name ?? '(unknown)';
    }

    return {
      agent_id: agentId,
      agent_name: agentName,
      runs,
      findings_total: findingsTotal,
      accepted,
      dismissed,
      pending,
      accept_rate,
      dismiss_rate,
      avg_findings_per_run,
      total_cost_usd: totalCostUsd,
      avg_cost_usd,
      avg_latency_ms,
      findings_by_severity,
      trend,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /agent-performance (dashboard)
  // ---------------------------------------------------------------------------

  async getDashboard(workspaceId: string, params: PeriodParams): Promise<AgentPerformance> {
    const resolved = this.resolvePeriod(params);
    const { from, to } = resolved;
    const prev = this.previousPeriod({ from, to });

    // Parallel fetch: current period data + previous period data
    const [
      runsRows,
      findingsRows,
      dailyTrendRows,
      modelCostRows,
      trendRows,
      prevRunsRows,
      prevFindingsRows,
    ] = await Promise.all([
      this.repo.aggregateRunsByAgent(workspaceId, from, to),
      this.repo.aggregateFindingsByAgent(workspaceId, from, to),
      this.repo.getDailyRunsTrend(workspaceId, from, to),
      this.repo.getModelCostBreakdown(workspaceId, from, to),
      this.repo.getRunTrend(workspaceId, null, from, to),
      this.repo.aggregateRunsByAgent(workspaceId, prev.from, prev.to),
      this.repo.aggregateFindingsByAgent(workspaceId, prev.from, prev.to),
    ]);

    // Build per-agent merged data for current period
    const agentRows = this.buildAgentRows(runsRows, findingsRows, trendRows);
    // Build per-agent accept rates for previous period
    const prevAcceptRates = this.computeAcceptRates(prevFindingsRows);
    // Attach previous accept rates
    for (const row of agentRows) {
      const key = row.agent_id ?? '__deleted__';
      row.previous_accept_rate = prevAcceptRates.get(key) ?? null;
    }

    // Sort: accept_rate DESC (null last), then runs DESC, then agent_name ASC
    agentRows.sort((a, b) => {
      if (a.accept_rate !== null && b.accept_rate !== null) {
        if (b.accept_rate !== a.accept_rate) return b.accept_rate - a.accept_rate;
      } else if (a.accept_rate !== null) {
        return -1; // a has rate, b doesn't → a first
      } else if (b.accept_rate !== null) {
        return 1; // b has rate, a doesn't → b first
      }
      if (b.runs !== a.runs) return b.runs - a.runs;
      return a.agent_name.localeCompare(b.agent_name);
    });

    // Summary
    const total_runs = runsRows.reduce((s, r) => s + Number(r.runs), 0);

    // Total cost: use canonical DB SUM string to avoid float re-accumulation
    let total_cost_usd: number | null = null;
    {
      const allCostStrs = runsRows
        .filter((r) => r.totalCostStr != null)
        .map((r) => parseFloat(r.totalCostStr!));
      if (allCostStrs.length > 0) {
        total_cost_usd = allCostStrs.reduce((s, v) => s + v, 0);
      }
    }

    // Previous period total cost
    let previous_total_cost_usd: number | null = null;
    {
      const prevCostStrs = prevRunsRows
        .filter((r) => r.totalCostStr != null)
        .map((r) => parseFloat(r.totalCostStr!));
      if (prevCostStrs.length > 0) {
        previous_total_cost_usd = prevCostStrs.reduce((s, v) => s + v, 0);
      }
    }

    // Pooled accept rate across all agents (not mean of rates)
    let avg_accept_rate: number | null = null;
    {
      const totalAccepted = findingsRows.reduce((s, r) => s + Number(r.accepted), 0);
      const totalDismissed = findingsRows.reduce((s, r) => s + Number(r.dismissed), 0);
      const totalActed = totalAccepted + totalDismissed;
      if (totalActed > 0) {
        avg_accept_rate = totalAccepted / totalActed;
      }
    }

    // Most active: agent with most runs; tie-break by last_run_at DESC, then name ASC
    let most_active: AgentPerformance['summary']['most_active'] = null;
    if (runsRows.length > 0) {
      // Only consider non-deleted agents for "most_active" (the plan says agent_id/agent_name required non-null)
      const activeRunRows = runsRows.filter((r) => r.agentId !== null && r.agentName !== null);
      if (activeRunRows.length > 0) {
        const sorted = [...activeRunRows].sort((a, b) => {
          const runsA = Number(a.runs);
          const runsB = Number(b.runs);
          if (runsB !== runsA) return runsB - runsA;
          // Tie-break by last_run_at DESC
          const latA = a.lastRunAt ?? '';
          const latB = b.lastRunAt ?? '';
          if (latB !== latA) return latB.localeCompare(latA);
          // Then by name ASC
          return (a.agentName ?? '').localeCompare(b.agentName ?? '');
        });
        const top = sorted[0]!;
        // Find accept rate for this agent
        const agentRow = agentRows.find((r) => r.agent_id === top.agentId);
        most_active = {
          agent_id: top.agentId!,
          agent_name: top.agentName!,
          runs: Number(top.runs),
          accept_rate: agentRow?.accept_rate ?? null,
        };
      }
    }

    // Daily runs trend for summary card
    const runs_trend: StatPoint[] = dailyTrendRows.map((r) => ({
      label: r.day,
      value: Number(r.runs),
    }));

    // cost_by_agent
    const cost_by_agent: AgentCostBreakdown[] = agentRows
      .filter((r) => {
        // Find the run row to get total cost
        const key = r.agent_id;
        const runRow = runsRows.find((rr) => rr.agentId === key);
        return runRow?.totalCostStr != null;
      })
      .map((r) => {
        const runRow = runsRows.find((rr) => rr.agentId === r.agent_id);
        return {
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          cost_usd: parseFloat(runRow!.totalCostStr!),
        };
      });

    // cost_by_model
    const cost_by_model: ModelCostBreakdown[] = modelCostRows
      .filter((r) => r.totalCostStr != null && parseFloat(r.totalCostStr) > 0)
      .map((r) => ({
        model: r.model,
        cost_usd: parseFloat(r.totalCostStr!),
      }));

    return {
      period: {
        preset: resolved.preset,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      summary: {
        total_runs,
        runs_trend,
        total_cost_usd,
        previous_total_cost_usd,
        avg_accept_rate,
        most_active,
      },
      agents: agentRows,
      cost_by_agent,
      cost_by_model,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the per-agent performance rows by merging runs + findings + trends.
   * Returns rows sorted by the effective agent key (null = deleted agent last).
   */
  private buildAgentRows(
    runsRows: RunsByAgentRow[],
    findingsRows: FindingsByAgentRow[],
    trendRows: RunTrendRow[],
  ): (AgentPerformanceRow & { previous_accept_rate: number | null })[] {
    // Group findings by effective agent key
    // Key = agentId if agent still exists, else null (deleted)
    const findingsByKey = new Map<string | null, FindingsByAgentRow[]>();
    for (const r of findingsRows) {
      // Deleted agent: reviewAgentId IS NULL, or agentExists IS NULL (FK mismatch)
      const key = (r.reviewAgentId == null || r.agentExists == null) ? null : r.reviewAgentId;
      const arr = findingsByKey.get(key) ?? [];
      arr.push(r);
      findingsByKey.set(key, arr);
    }

    // Group trend rows by agentId (null = deleted)
    const trendByKey = new Map<string | null, RunTrendRow[]>();
    for (const r of trendRows) {
      const key = r.agentId ?? null;
      const arr = trendByKey.get(key) ?? [];
      arr.push(r);
      trendByKey.set(key, arr);
    }

    // Collect all unique agent keys from runs
    const allKeys = new Set<string | null>();
    for (const r of runsRows) {
      allKeys.add(r.agentId ?? null);
    }

    const result: (AgentPerformanceRow & { previous_accept_rate: number | null })[] = [];

    for (const key of allKeys) {
      // Find the run rows for this key
      // If key is null, aggregate all runs where agentId IS NULL
      const runRow = runsRows.find((r) => (r.agentId ?? null) === key);
      if (!runRow) continue;

      const runs = Number(runRow.runs);
      const countCost = Number(runRow.countCost);
      const totalCostStr = runRow.totalCostStr;
      const avg_cost_usd = countCost > 0 && totalCostStr != null
        ? parseFloat(totalCostStr) / countCost
        : null;
      const countDuration = Number(runRow.countDuration);
      const sumDuration = runRow.sumDuration != null ? Number(runRow.sumDuration) : null;
      const avg_duration_ms = countDuration > 0 && sumDuration !== null
        ? sumDuration / countDuration
        : null;
      const last_run_at = runRow.lastRunAt != null ? String(runRow.lastRunAt) : null;

      // Agent name: use joined name if available, else "(deleted agent)"
      const agent_name = (key !== null && runRow.agentName != null)
        ? runRow.agentName
        : '(deleted agent)';

      // Findings for this agent key
      const agentFindings = findingsByKey.get(key) ?? [];
      const accepted = agentFindings.reduce((s, r) => s + Number(r.accepted), 0);
      const dismissed = agentFindings.reduce((s, r) => s + Number(r.dismissed), 0);
      const acted = accepted + dismissed;
      const accept_rate = acted > 0 ? accepted / acted : null;

      // Trend sparkline
      const agentTrendRows = trendByKey.get(key) ?? [];
      const trend: StatPoint[] = agentTrendRows.map((r) => ({
        label: r.ranAt instanceof Date ? r.ranAt.toISOString() : String(r.ranAt),
        value: r.findingsCount ?? 0,
      }));

      result.push({
        agent_id: key,
        agent_name,
        runs,
        avg_cost_usd,
        avg_duration_ms,
        accept_rate,
        previous_accept_rate: null, // filled in by getDashboard
        last_run_at,
        trend,
      });
    }

    return result;
  }

  /**
   * Compute per-agent accept rates from findings rows.
   * Returns a Map<agentKey, acceptRate|null>.
   * Key is agentId or '__deleted__' for the null bucket.
   */
  private computeAcceptRates(findingsRows: FindingsByAgentRow[]): Map<string, number | null> {
    const byKey = new Map<string, { accepted: number; dismissed: number }>();

    for (const r of findingsRows) {
      const key = (r.reviewAgentId == null || r.agentExists == null)
        ? '__deleted__'
        : r.reviewAgentId;
      const prev = byKey.get(key) ?? { accepted: 0, dismissed: 0 };
      prev.accepted += Number(r.accepted);
      prev.dismissed += Number(r.dismissed);
      byKey.set(key, prev);
    }

    const result = new Map<string, number | null>();
    for (const [key, { accepted, dismissed }] of byKey) {
      const acted = accepted + dismissed;
      result.set(key, acted > 0 ? accepted / acted : null);
    }
    return result;
  }
}
