/**
 * Unit tests for server/src/modules/multi-runs/service.ts (MultiRunsService).
 * Hermetic — no real DB, no network.
 *
 * Test intentions:
 * 1. createMultiRun
 *    - PR not found → throws NotFoundError
 *    - one agent ID not in workspace → throws AppError (422)
 *    - happy path: calls ReviewService.runReview with the multiRunId; returns multi_run_id + runs
 *    - mocks needed: MultiRunsRepository (repo), ReviewService (runReview), container (reviewRepo, agentsRepo)
 *
 * 2. getMultiRun
 *    - multi-run not found → throws NotFoundError
 *    - cost/duration aggregation: null rows excluded; only non-null rows summed
 *    - all-null cost/duration rows → total_cost_usd = null and total_duration_ms = null
 *
 * 3. getEstimates
 *    - agent with 0 historical runs → has_historical_data: false, null estimates
 *    - agent with >10 historical runs (ordered DESC) → only averages first 10
 *
 * 4. getFindings
 *    - multi-run not found (workspace-scoped) → throws NotFoundError
 *    - delegates to groupFindingsByFileAndOverlap with correct arguments
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('./repository.js', () => {
  const MultiRunsRepository = vi.fn();
  MultiRunsRepository.prototype.insertMultiRun = vi.fn();
  MultiRunsRepository.prototype.findMultiRunById = vi.fn();
  MultiRunsRepository.prototype.getAgentRunsByMultiRunId = vi.fn();
  MultiRunsRepository.prototype.getLastNRunsPerAgent = vi.fn();
  MultiRunsRepository.prototype.getLastFindingSummaryPerAgent = vi.fn();
  MultiRunsRepository.prototype.getReviewsAndFindingsByAgentRunIds = vi.fn();
  return { MultiRunsRepository };
});

vi.mock('../reviews/service.js', () => {
  const ReviewService = vi.fn();
  ReviewService.prototype.runReview = vi.fn();
  ReviewService.prototype.reapStaleRuns = vi.fn().mockResolvedValue(0);
  return { ReviewService };
});

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import { MultiRunsRepository } from './repository.js';
import { ReviewService } from '../reviews/service.js';
import { MultiRunsService } from './service.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';

// ============================================================================
// Constants
// ============================================================================

const WS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MULTI_RUN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENT_ID_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const AGENT_ID_2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ============================================================================
// Helpers
// ============================================================================

function mockRepo() {
  return MultiRunsRepository.prototype as unknown as Record<string, Mock>;
}

function mockReviewSvc() {
  return ReviewService.prototype as unknown as Record<string, Mock>;
}

function makeContainer(overrides: {
  getPull?: unknown;
  getById?: (ws: string, id: string) => Promise<unknown>;
  listEnabled?: unknown;
} = {}): Container {
  return {
    db: {} as never,
    reviewRepo: {
      getPull: vi.fn().mockResolvedValue(overrides.getPull ?? { id: PR_ID }),
    },
    agentsRepo: {
      getById: vi.fn().mockImplementation(overrides.getById ?? ((_ws: string, id: string) =>
        Promise.resolve({ id, name: `Agent-${id.slice(0, 4)}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled: true, workspaceId: WS_ID })
      )),
      listEnabled: vi.fn().mockResolvedValue(overrides.listEnabled ?? []),
    },
  } as unknown as Container;
}

// ============================================================================
// createMultiRun
// ============================================================================

describe('MultiRunsService.createMultiRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws NotFoundError when the pull request does not exist', async () => {
    const container = makeContainer({ getPull: null });
    // Override reviewRepo.getPull to return null
    (container.reviewRepo.getPull as Mock).mockResolvedValue(undefined);

    const service = new MultiRunsService(container);

    await expect(service.createMultiRun(WS_ID, PR_ID, [AGENT_ID_1])).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws a 422 AppError when an agent ID is not found in this workspace', async () => {
    const container = makeContainer({});
    // One agent resolves, one does not
    (container.agentsRepo.getById as Mock).mockImplementation((_ws: string, id: string) =>
      id === AGENT_ID_1
        ? Promise.resolve({ id: AGENT_ID_1, name: 'Agent1', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's' })
        : Promise.resolve(undefined),
    );

    const service = new MultiRunsService(container);

    await expect(
      service.createMultiRun(WS_ID, PR_ID, [AGENT_ID_1, AGENT_ID_2]),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'agent_not_found',
    });
  });

  it('deduplicates agentIds: calls agentsRepo.getById once per unique UUID even when duplicates are sent', async () => {
    // Send 3 entries: AGENT_ID_1 twice + AGENT_ID_2 once → 2 unique IDs.
    // After deduplication, getById must be called exactly twice.
    const container = makeContainer();

    mockRepo().insertMultiRun!.mockResolvedValue(MULTI_RUN_ID);
    mockReviewSvc().runReview!.mockResolvedValue({ runs: [], reviews: [] });

    const service = new MultiRunsService(container);
    await service.createMultiRun(WS_ID, PR_ID, [AGENT_ID_1, AGENT_ID_1, AGENT_ID_2]);

    // 2 calls — one for AGENT_ID_1, one for AGENT_ID_2 (duplicate AGENT_ID_1 dropped)
    expect((container.agentsRepo.getById as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect((container.agentsRepo.getById as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(WS_ID, AGENT_ID_1);
    expect((container.agentsRepo.getById as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(WS_ID, AGENT_ID_2);
  });

  it('happy path: inserts multi-run, calls runReview with multiRunId, returns the result', async () => {
    const container = makeContainer();

    mockRepo().insertMultiRun!.mockResolvedValue(MULTI_RUN_ID);
    mockReviewSvc().runReview!.mockResolvedValue({
      runs: [
        { run_id: 'run-1', agent_id: AGENT_ID_1, agent_name: 'Agent1' },
      ],
      reviews: [],
    });

    const service = new MultiRunsService(container);
    const result = await service.createMultiRun(WS_ID, PR_ID, [AGENT_ID_1]);

    expect(result.multi_run_id).toBe(MULTI_RUN_ID);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.run_id).toBe('run-1');

    // runReview must receive the multiRunId in opts
    const callArgs = mockReviewSvc().runReview!.mock.calls[0] as unknown[];
    // callArgs = [workspaceId, prId, agents, logger, opts]
    const opts = callArgs[4] as { multiRunId: string };
    expect(opts.multiRunId).toBe(MULTI_RUN_ID);
  });
});

// ============================================================================
// getMultiRun
// ============================================================================

describe('MultiRunsService.getMultiRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws NotFoundError when the multi-run is not found', async () => {
    const container = makeContainer();
    mockRepo().findMultiRunById!.mockResolvedValue(undefined);

    const service = new MultiRunsService(container);

    await expect(service.getMultiRun(WS_ID, MULTI_RUN_ID)).rejects.toThrow(NotFoundError);
  });

  it('sums only non-null cost_usd and duration_ms rows', async () => {
    const container = makeContainer();
    mockRepo().findMultiRunById!.mockResolvedValue({
      id: MULTI_RUN_ID,
      prId: PR_ID,
      prNumber: 42,
      ranAt: new Date('2026-07-01T00:00:00Z'),
    });
    mockRepo().getAgentRunsByMultiRunId!.mockResolvedValue([
      { id: 'run-1', agentId: AGENT_ID_1, agentName: 'A', status: 'done', score: 80, findingsCount: 2, costUsd: '0.01000000', durationMs: 3000, error: null },
      { id: 'run-2', agentId: AGENT_ID_2, agentName: 'B', status: 'done', score: 70, findingsCount: 1, costUsd: null, durationMs: null, error: null },
      { id: 'run-3', agentId: null, agentName: null, status: 'failed', score: null, findingsCount: null, costUsd: '0.00500000', durationMs: 5000, error: 'timeout' },
    ]);

    const service = new MultiRunsService(container);
    const result = await service.getMultiRun(WS_ID, MULTI_RUN_ID);

    // Only run-1 and run-3 have non-null cost → sum = 0.01 + 0.005 = 0.015
    expect(result.total_cost_usd).toBeCloseTo(0.015, 6);
    // Only run-1 and run-3 have non-null duration → sum = 3000 + 5000 = 8000
    expect(result.total_duration_ms).toBe(8000);
  });

  it('returns total_cost_usd = null and total_duration_ms = null when all rows are null', async () => {
    const container = makeContainer();
    mockRepo().findMultiRunById!.mockResolvedValue({
      id: MULTI_RUN_ID,
      prId: PR_ID,
      prNumber: null,
      ranAt: new Date('2026-07-01T00:00:00Z'),
    });
    mockRepo().getAgentRunsByMultiRunId!.mockResolvedValue([
      { id: 'run-1', agentId: AGENT_ID_1, agentName: 'A', status: 'running', score: null, findingsCount: null, costUsd: null, durationMs: null, error: null },
    ]);

    const service = new MultiRunsService(container);
    const result = await service.getMultiRun(WS_ID, MULTI_RUN_ID);

    expect(result.total_cost_usd).toBeNull();
    expect(result.total_duration_ms).toBeNull();
  });
});

// ============================================================================
// getEstimates
// ============================================================================

describe('MultiRunsService.getEstimates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns has_historical_data: false with null estimates for an agent with 0 historical runs', async () => {
    const agent = { id: AGENT_ID_1, name: 'Agent1', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled: true, workspaceId: WS_ID };
    const container = makeContainer({ listEnabled: [agent] });

    // No historical runs
    mockRepo().getLastNRunsPerAgent!.mockResolvedValue([]);
    mockRepo().getLastFindingSummaryPerAgent!.mockResolvedValue([]);

    const service = new MultiRunsService(container);
    const estimates = await service.getEstimates(WS_ID, PR_ID);

    expect(estimates).toHaveLength(1);
    expect(estimates[0]!.has_historical_data).toBe(false);
    expect(estimates[0]!.estimated_duration_ms).toBeNull();
    expect(estimates[0]!.estimated_cost_usd).toBeNull();
  });

  it('averages only the first 10 runs (ordered DESC) for an agent with more than 10 historical runs', async () => {
    const agent = { id: AGENT_ID_1, name: 'Agent1', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled: true, workspaceId: WS_ID };
    const container = makeContainer({ listEnabled: [agent] });

    // 15 rows (already ordered DESC by repository). Service slices to first 10.
    // Durations: first 10 are 1000ms each, last 5 are 9999ms each.
    // If only first 10 are used: avg = 1000ms.
    const historyRows = Array.from({ length: 15 }, (_, i) => ({
      agentId: AGENT_ID_1,
      costUsd: '0.01',
      durationMs: i < 10 ? 1000 : 9999,
    }));
    mockRepo().getLastNRunsPerAgent!.mockResolvedValue(historyRows);
    mockRepo().getLastFindingSummaryPerAgent!.mockResolvedValue([]);

    const service = new MultiRunsService(container);
    const estimates = await service.getEstimates(WS_ID, PR_ID);

    expect(estimates).toHaveLength(1);
    expect(estimates[0]!.has_historical_data).toBe(true);
    // avg of first 10 durations (all 1000ms) = 1000
    expect(estimates[0]!.estimated_duration_ms).toBe(1000);
  });

  it('returns [] when workspace has no enabled agents', async () => {
    const container = makeContainer({ listEnabled: [] });
    const service = new MultiRunsService(container);
    const estimates = await service.getEstimates(WS_ID, PR_ID);
    expect(estimates).toHaveLength(0);
  });
});

// ============================================================================
// getFindings
// ============================================================================

describe('MultiRunsService.getFindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws NotFoundError when multi-run is not found (workspace-scoped check)', async () => {
    const container = makeContainer();
    mockRepo().findMultiRunById!.mockResolvedValue(undefined);

    const service = new MultiRunsService(container);

    await expect(service.getFindings(WS_ID, MULTI_RUN_ID)).rejects.toThrow(NotFoundError);
    // Verify the workspace-scoped findMultiRunById was called with correct args
    expect(mockRepo().findMultiRunById!).toHaveBeenCalledWith(WS_ID, MULTI_RUN_ID);
  });

  it('delegates findings to groupFindingsByFileAndOverlap and returns grouped result', async () => {
    const container = makeContainer();
    mockRepo().findMultiRunById!.mockResolvedValue({
      id: MULTI_RUN_ID,
      prId: PR_ID,
      prNumber: 42,
      ranAt: new Date(),
    });
    mockRepo().getAgentRunsByMultiRunId!.mockResolvedValue([
      { id: 'run-1', agentId: AGENT_ID_1, agentName: 'Alpha', status: 'done', score: 80, findingsCount: 1, costUsd: null, durationMs: null, error: null },
    ]);

    const mockFinding = {
      agentRunId: 'run-1',
      agentId: AGENT_ID_1,
      agentName: 'Alpha',
      finding: {
        id: 'f1',
        reviewId: 'rev1',
        file: 'src/index.ts',
        startLine: 10,
        endLine: 10,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Issue',
        rationale: 'Bad code',
        suggestion: null,
        confidence: 0.9,
        kind: 'finding',
        trifectaComponents: null,
        acceptedAt: null,
        dismissedAt: null,
      },
      reviewId: 'rev1',
    };
    mockRepo().getReviewsAndFindingsByAgentRunIds!.mockResolvedValue([mockFinding]);

    const service = new MultiRunsService(container);
    const result = await service.getFindings(WS_ID, MULTI_RUN_ID);

    // groups should be produced (at least 1 group from the single finding)
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.file).toBe('src/index.ts');
    // agents array should have one entry for run-1
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.agent_name).toBe('Alpha');
    expect(result.agents[0]!.findings).toHaveLength(1);
  });
});
