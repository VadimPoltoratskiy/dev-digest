import type { EvalDashboard, EvalRunRecord, EvalTrendPoint } from '@devdigest/shared';

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

/**
 * Assembles the full EvalDashboard DTO from raw repository data.
 * Groups runs into batches by ran_at, computes current/prior/delta/trend/recent_runs.
 */
export function assembleDashboard(raw: EvalDashboardRaw): EvalDashboard {
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
    alert: null,
  };
}
