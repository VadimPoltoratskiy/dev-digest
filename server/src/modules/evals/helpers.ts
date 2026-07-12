import type {
  EvalDashboard,
  EvalDashboardAgentSummary,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';

/**
 * Raw row returned by the repository's joined query over eval_runs + eval_cases.
 * Field names mirror Drizzle camelCase column names.
 */
export interface EvalRunJoinedRow {
  id: string;
  caseId: string;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Joined from eval_cases.name — null only if the row somehow lacks a join match. */
  caseName: string | null;
}

/** Intermediate data structure returned by the repository query function. */
export interface EvalDashboardRaw {
  caseIds: string[];
  casesTotal: number;
  runs: EvalRunJoinedRow[];
  ownerId: string | undefined;
}

/** One row from the agents table, as selected by `queryEvalDashboardAgentsData`. */
export interface EvalDashboardAgentRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  version: number;
}

/** Intermediate data structure returned by `queryEvalDashboardAgentsData`. */
export interface EvalDashboardAgentsRaw {
  agentRows: EvalDashboardAgentRow[];
  caseRows: Array<{ id: string; ownerId: string }>;
  runRows: Array<EvalRunJoinedRow & { ownerId: string }>;
}

// ---------------------------------------------------------------------------
// Pure helper functions — no I/O, no imports from platform or adapters
// ---------------------------------------------------------------------------

/** Returns the zero-value EvalDashboard when there are no cases or no runs. */
export function zeroDashboard(ownerId: string | undefined, casesTotal: number): EvalDashboard {
  return {
    owner_kind: 'agent',
    owner_id: ownerId ?? null,
    cases_total: casesTotal,
    current: {
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
  };
}

/**
 * Computes batch-level metrics from a group of rows sharing the same ran_at.
 * recall/precision/citation_accuracy are denormalized — read from the first row.
 */
export function batchMetrics(
  batch: Array<{
    pass: boolean | null;
    recall: number | null;
    precision: number | null;
    citationAccuracy: number | null;
  }>,
) {
  const first = batch[0]!;
  const tracesPassed = batch.filter((r) => r.pass === true).length;
  return {
    recall: first.recall ?? 0,
    precision: first.precision ?? 0,
    citation_accuracy: first.citationAccuracy ?? 0,
    traces_passed: tracesPassed,
    traces_total: batch.length,
  };
}

/**
 * Maps a raw batch (array of joined rows) to `EvalRunRecord[]` for the
 * `recent_runs` field of the dashboard.
 */
export function toEvalRunRecords(batch: EvalRunJoinedRow[]): EvalRunRecord[] {
  return batch.map((r) => ({
    id: r.id,
    case_id: r.caseId,
    case_name: r.caseName ?? null,
    ran_at: r.ranAt.toISOString(),
    actual_output: r.actualOutput,
    pass: r.pass ?? null,
    recall: r.recall ?? null,
    precision: r.precision ?? null,
    citation_accuracy: r.citationAccuracy ?? null,
    duration_ms: r.durationMs ?? null,
    cost_usd: r.costUsd ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Alert — flags a regression on the biggest-dropping metric between the
// current and prior batch (only meaningful when scoped to one agent).
// ---------------------------------------------------------------------------

const ALERT_THRESHOLD = 0.02;

const ALERT_METRIC_LABELS = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation accuracy',
} as const;

type AlertMetrics = { recall: number; precision: number; citation_accuracy: number };

/**
 * Finds the metric with the largest regression between `current` and `prior`;
 * returns a human-readable alert string when that drop is >= 2pts, else null.
 * `agentVersion`, when given, is included as "on vN" in the message.
 */
export function computeAlert(
  current: AlertMetrics,
  prior: AlertMetrics | null,
  agentVersion?: number,
): string | null {
  if (!prior) return null;

  const deltas: AlertMetrics = {
    recall: current.recall - prior.recall,
    precision: current.precision - prior.precision,
    citation_accuracy: current.citation_accuracy - prior.citation_accuracy,
  };

  let worstMetric: keyof AlertMetrics | null = null;
  let worstDelta = 0;
  for (const key of Object.keys(deltas) as (keyof AlertMetrics)[]) {
    if (deltas[key] < worstDelta) {
      worstDelta = deltas[key];
      worstMetric = key;
    }
  }

  if (worstMetric === null || Math.abs(worstDelta) < ALERT_THRESHOLD) return null;

  const pts = Math.round(Math.abs(worstDelta) * 100);
  const versionClause = agentVersion != null ? ` on v${agentVersion}` : '';
  return `${ALERT_METRIC_LABELS[worstMetric]} dipped ${pts}pts${versionClause} — review before promoting.`;
}

/**
 * Assembles the full EvalDashboard DTO from raw repository data.
 * Groups runs into batches by ran_at, computes current/prior/delta/trend/recent_runs.
 * `agentVersion` is only used (for the alert message) when `raw.ownerId` scopes
 * this call to a single agent; the workspace-wide call never sets it.
 */
export function assembleDashboard(raw: EvalDashboardRaw, agentVersion?: number): EvalDashboard {
  const { casesTotal, runs, ownerId } = raw;

  if (runs.length === 0) {
    return zeroDashboard(ownerId, casesTotal);
  }

  // Group into batches by ranAt ISO string key; Map insertion order = desc ranAt
  const batchMap = new Map<string, EvalRunJoinedRow[]>();
  for (const run of runs) {
    const key = run.ranAt.toISOString();
    const batch = batchMap.get(key);
    if (batch) {
      batch.push(run);
    } else {
      batchMap.set(key, [run]);
    }
  }

  const batchKeys = Array.from(batchMap.keys());
  const currentBatch = batchMap.get(batchKeys[0]!)!;
  const priorBatch = batchKeys[1] ? batchMap.get(batchKeys[1]!)! : null;

  const current = batchMetrics(currentBatch);
  const prior = priorBatch ? batchMetrics(priorBatch) : null;
  const delta = {
    recall: prior ? current.recall - prior.recall : 0,
    precision: prior ? current.precision - prior.precision : 0,
    citation_accuracy: prior ? current.citation_accuracy - prior.citation_accuracy : 0,
  };

  // Trend: up to 20 batches, chronological (oldest first)
  const trendKeys = batchKeys.slice(0, 20).reverse();
  const trend: EvalTrendPoint[] = trendKeys.map((key) => {
    const batch = batchMap.get(key)!;
    const m = batchMetrics(batch);
    const cost = batch.reduce<number | null>((sum, r) => {
      if (sum === null || r.costUsd === null) return null;
      return sum + r.costUsd;
    }, 0);
    return {
      ran_at: key,
      recall: m.recall,
      precision: m.precision,
      citation_accuracy: m.citation_accuracy,
      pass_rate: m.traces_total > 0 ? m.traces_passed / m.traces_total : 0,
      cost_usd: cost,
    };
  });

  const currentCostUsd = currentBatch.reduce<number | null>((sum, r) => {
    if (sum === null || r.costUsd === null) return null;
    return sum + r.costUsd;
  }, 0);

  // A regression alert only makes sense scoped to one agent (ownerId set) —
  // "biggest drop" across a mixed workspace of agents isn't meaningful.
  const alert = ownerId ? computeAlert(current, prior, agentVersion) : null;

  return {
    owner_kind: 'agent',
    owner_id: ownerId ?? null,
    cases_total: casesTotal,
    current: {
      recall: current.recall,
      precision: current.precision,
      citation_accuracy: current.citation_accuracy,
      traces_passed: current.traces_passed,
      traces_total: current.traces_total,
      cost_usd: currentCostUsd,
    },
    delta,
    trend,
    recent_runs: toEvalRunRecords(currentBatch),
    alert,
  };
}

// ---------------------------------------------------------------------------
// Agents summary — per-agent rows for the workspace dashboard's agent list.
// ---------------------------------------------------------------------------

/**
 * Assembles per-agent eval summaries from raw repository data. Groups run
 * rows by owner (agent) then by ran_at batch, mirroring `assembleDashboard`'s
 * batching but scoped per agent. Agents with zero runs get `current: null,
 * trend: []` rather than a zero-value dashboard (there's nothing to plot).
 */
export function assembleAgentsSummary(raw: EvalDashboardAgentsRaw): EvalDashboardAgentSummary[] {
  const { agentRows, caseRows, runRows } = raw;

  const casesTotalByAgent = new Map<string, number>();
  for (const c of caseRows) {
    casesTotalByAgent.set(c.ownerId, (casesTotalByAgent.get(c.ownerId) ?? 0) + 1);
  }

  const runsByAgent = new Map<string, (EvalRunJoinedRow & { ownerId: string })[]>();
  for (const r of runRows) {
    const list = runsByAgent.get(r.ownerId);
    if (list) list.push(r);
    else runsByAgent.set(r.ownerId, [r]);
  }

  return agentRows.map((agent): EvalDashboardAgentSummary => {
    const casesTotal = casesTotalByAgent.get(agent.id) ?? 0;
    const runs = runsByAgent.get(agent.id) ?? [];

    const base = {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider as EvalDashboardAgentSummary['provider'],
      model: agent.model,
      version: agent.version,
      cases_total: casesTotal,
    };

    if (runs.length === 0) {
      return { ...base, last_ran_at: null, current: null, trend: [] };
    }

    // Group into batches by ranAt; `runs` preserves the repository's
    // desc-by-ranAt ordering, so batchKeys[0] is the most recent batch.
    const batchMap = new Map<string, EvalRunJoinedRow[]>();
    for (const run of runs) {
      const key = run.ranAt.toISOString();
      const batch = batchMap.get(key);
      if (batch) batch.push(run);
      else batchMap.set(key, [run]);
    }

    const batchKeys = Array.from(batchMap.keys());
    const currentBatch = batchMap.get(batchKeys[0]!)!;
    const current = batchMetrics(currentBatch);

    const trendKeys = batchKeys.slice(0, 8).reverse();
    const trend = trendKeys.map((key) => batchMetrics(batchMap.get(key)!).recall);

    return {
      ...base,
      last_ran_at: batchKeys[0]!,
      current: {
        recall: current.recall,
        precision: current.precision,
        citation_accuracy: current.citation_accuracy,
      },
      trend,
    };
  });
}
