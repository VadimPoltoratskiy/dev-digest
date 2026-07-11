import { describe, it, expect } from 'vitest';
import { computeAlert, assembleAgentsSummary } from './helpers.js';
import type { EvalDashboardAgentsRaw, EvalRunJoinedRow } from './helpers.js';

// ---------------------------------------------------------------------------
// computeAlert
// ---------------------------------------------------------------------------

describe('computeAlert', () => {
  const metrics = (recall: number, precision: number, citation_accuracy: number) => ({
    recall,
    precision,
    citation_accuracy,
  });

  it('returns null when there is no prior batch', () => {
    expect(computeAlert(metrics(0.9, 0.9, 0.9), null)).toBeNull();
  });

  it('returns null when the largest drop is below the 2pt threshold', () => {
    // precision drops by 1pt (0.01) — below threshold
    expect(computeAlert(metrics(0.9, 0.89, 0.9), metrics(0.9, 0.9, 0.9))).toBeNull();
  });

  it('returns null when metrics improved or stayed flat', () => {
    expect(computeAlert(metrics(0.95, 0.95, 0.95), metrics(0.9, 0.9, 0.9))).toBeNull();
  });

  it('flags precision when it has the largest drop, with the version clause', () => {
    // precision drops 2pts (0.91 -> 0.89... use exact 0.02 for determinism)
    const alert = computeAlert(metrics(0.86, 0.91, 0.95), metrics(0.82, 0.93, 0.94), 7);
    expect(alert).toBe('Precision dipped 2pts on v7 — review before promoting.');
  });

  it('omits the version clause when agentVersion is not provided', () => {
    const alert = computeAlert(metrics(0.86, 0.91, 0.95), metrics(0.82, 0.93, 0.94));
    expect(alert).toBe('Precision dipped 2pts — review before promoting.');
  });

  it('picks the metric with the single largest regression when multiple drop', () => {
    // recall drops 3pts, precision drops 2pts, citation drops 1pt — recall wins
    const alert = computeAlert(metrics(0.87, 0.89, 0.94), metrics(0.9, 0.91, 0.95));
    expect(alert).toBe('Recall dipped 3pts — review before promoting.');
  });

  it('flags citation_accuracy regressions', () => {
    const alert = computeAlert(metrics(0.9, 0.9, 0.8), metrics(0.9, 0.9, 0.9));
    expect(alert).toBe('Citation accuracy dipped 10pts — review before promoting.');
  });
});

// ---------------------------------------------------------------------------
// assembleAgentsSummary
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<EvalRunJoinedRow & { ownerId: string }>): EvalRunJoinedRow & {
  ownerId: string;
} {
  return {
    id: 'run-1',
    caseId: 'case-1',
    ranAt: new Date('2026-01-01T00:00:00Z'),
    actualOutput: {},
    pass: true,
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    durationMs: 100,
    costUsd: 0.01,
    caseName: 'case',
    ownerId: 'agent-1',
    ...overrides,
  };
}

describe('assembleAgentsSummary', () => {
  it('returns current: null and trend: [] for an agent with no eval cases at all', () => {
    const raw: EvalDashboardAgentsRaw = {
      agentRows: [
        { id: 'agent-1', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', version: 1 },
      ],
      caseRows: [],
      runRows: [],
    };

    const [summary] = assembleAgentsSummary(raw);
    expect(summary).toEqual({
      agent_id: 'agent-1',
      agent_name: 'Security Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      version: 1,
      cases_total: 0,
      last_ran_at: null,
      current: null,
      trend: [],
    });
  });

  it('returns current: null and trend: [] for an agent with cases but no runs yet', () => {
    const raw: EvalDashboardAgentsRaw = {
      agentRows: [
        { id: 'agent-1', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', version: 1 },
      ],
      caseRows: [{ id: 'case-1', ownerId: 'agent-1' }],
      runRows: [],
    };

    const [summary] = assembleAgentsSummary(raw);
    expect(summary!.cases_total).toBe(1);
    expect(summary!.current).toBeNull();
    expect(summary!.trend).toEqual([]);
    expect(summary!.last_ran_at).toBeNull();
  });

  it('computes current metrics from the latest batch and a chronological trend', () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-01-02T00:00:00Z');

    const raw: EvalDashboardAgentsRaw = {
      agentRows: [
        { id: 'agent-1', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', version: 2 },
      ],
      caseRows: [
        { id: 'case-1', ownerId: 'agent-1' },
        { id: 'case-2', ownerId: 'agent-1' },
      ],
      // Repository returns rows ordered desc by ranAt (newest batch first).
      runRows: [
        makeRun({ id: 'r3', ranAt: newer, recall: 0.9, precision: 0.95, citationAccuracy: 0.92 }),
        makeRun({ id: 'r4', ranAt: newer, recall: 0.9, precision: 0.95, citationAccuracy: 0.92 }),
        makeRun({ id: 'r1', ranAt: older, recall: 0.8, precision: 0.85, citationAccuracy: 0.88 }),
        makeRun({ id: 'r2', ranAt: older, recall: 0.8, precision: 0.85, citationAccuracy: 0.88 }),
      ],
    };

    const [summary] = assembleAgentsSummary(raw);
    expect(summary!.last_ran_at).toBe(newer.toISOString());
    expect(summary!.current).toEqual({ recall: 0.9, precision: 0.95, citation_accuracy: 0.92 });
    // Oldest -> newest
    expect(summary!.trend).toEqual([0.8, 0.9]);
  });

  it('scopes cases/runs per agent and does not leak across agents', () => {
    const raw: EvalDashboardAgentsRaw = {
      agentRows: [
        { id: 'agent-1', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', version: 1 },
        { id: 'agent-2', name: 'Performance Reviewer', provider: 'anthropic', model: 'claude', version: 1 },
      ],
      caseRows: [
        { id: 'case-1', ownerId: 'agent-1' },
        { id: 'case-2', ownerId: 'agent-2' },
      ],
      runRows: [makeRun({ id: 'r1', ownerId: 'agent-1', recall: 1, precision: 1, citationAccuracy: 1 })],
    };

    const summaries = assembleAgentsSummary(raw);
    const byId = new Map(summaries.map((s) => [s.agent_id, s]));
    expect(byId.get('agent-1')!.current).not.toBeNull();
    expect(byId.get('agent-2')!.current).toBeNull();
    expect(byId.get('agent-2')!.cases_total).toBe(1);
  });

  it('caps the trend at 8 points, keeping the most recent batches', () => {
    const runs: (EvalRunJoinedRow & { ownerId: string })[] = [];
    // 10 batches, each 1 hour apart, newest first (matches repository ordering)
    for (let i = 10; i >= 1; i--) {
      const ranAt = new Date(2026, 0, 1, i);
      runs.push(makeRun({ id: `r${i}`, ranAt, recall: i / 10 }));
    }

    const raw: EvalDashboardAgentsRaw = {
      agentRows: [{ id: 'agent-1', name: 'Agent', provider: 'openai', model: 'gpt-4.1', version: 1 }],
      caseRows: [{ id: 'case-1', ownerId: 'agent-1' }],
      runRows: runs,
    };

    const [summary] = assembleAgentsSummary(raw);
    expect(summary!.trend).toHaveLength(8);
    // Newest batch is i=10 (recall 1.0); oldest kept is i=3 (recall 0.3), chronological order.
    expect(summary!.trend[0]).toBeCloseTo(0.3);
    expect(summary!.trend[7]).toBeCloseTo(1.0);
  });
});
