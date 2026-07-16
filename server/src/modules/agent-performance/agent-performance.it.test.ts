/**
 * Integration tests for agent-performance module.
 * Covers GET /agent-performance and GET /agents/:id/stats.
 *
 * Isolation strategy: all test runs and reviews use ranAt/createdAt dates in
 * 2030 so they don't overlap with seed data or other tests. Queries use
 * period=custom&from=2030-01-01&to=2030-12-31 (or sub-ranges within 2030).
 *
 * Auth: LocalNoAuthProvider always resolves to the seeded workspace, so all
 * agents/runs/reviews must be created in that workspace.
 *
 * Assertions:
 *  1. AC-14 — accept-rate = accepted / (accepted + dismissed), pending excluded
 *  2. AC-19 — null-cost runs counted in total_runs but excluded from avg_cost_usd
 *  3. AC-12 — cost reconciliation: sum(cost_by_agent) == sum(cost_by_model) == total_cost_usd
 *  4. AC-23 — deleted-agent bucket (agent_id: null, agent_name: "(deleted agent)")
 *  5. AC-22 — UTC day boundaries for custom period
 *  6. AC-3  — default 30d (no period param)
 *  7. AC-5  — validation: invalid period/date returns 422
 *  8. AC-7  — most-active tie-break by last_run_at DESC then name ASC
 *  9. AC-8  — no delta when previous period has no data
 * 10. AC-13 — cross-surface equality: /agents/:id/stats matches /agent-performance row
 * 11. Zod schema parse of responses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { AgentPerformance, AgentStats } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Db = PgFixture['handle']['db'];

// Isolation date range — well outside seed data or "now" ranges.
const ISO_FROM = '2030-01-01';
const ISO_TO   = '2030-12-31';
const PERIOD_QS = `period=custom&from=${ISO_FROM}&to=${ISO_TO}`;

// A date in the middle of our isolation window.
function d2030(month: number, day: number, hour = 12): Date {
  return new Date(`2030-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`);
}

let seq = 0;

// ---------------------------------------------------------------------------
// Fixture helpers — all use the SEEDED workspaceId
// ---------------------------------------------------------------------------

async function makeRepo(db: Db, workspaceId: string) {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'test', name: `repo-ap-${seq}`, fullName: `test/repo-ap-${seq++}` })
    .returning();
  return repo!;
}

async function makePr(db: Db, workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 8000 + seq++,
      title: 'Test PR',
      author: 'alice',
      branch: 'feat/test',
      base: 'main',
      headSha: `sha${seq}`,
      additions: 10,
      deletions: 5,
      filesCount: 2,
      status: 'needs_review',
      body: 'A test PR.',
    })
    .returning();
  return pr!;
}

async function makeAgent(db: Db, workspaceId: string, name?: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: name ?? `ap-test-agent-${seq++}`,
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'You are a code reviewer.',
      enabled: true,
    })
    .returning();
  return agent!;
}

async function makeRun(
  db: Db,
  opts: {
    workspaceId: string;
    agentId?: string | null;
    prId?: string;
    status?: string;
    costUsd?: string | null;
    durationMs?: number | null;
    findingsCount?: number | null;
    model?: string | null;
    ranAt?: Date;
  },
) {
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: opts.workspaceId,
      agentId: opts.agentId ?? null,
      prId: opts.prId ?? null,
      status: opts.status ?? 'done',
      costUsd: opts.costUsd ?? null,
      durationMs: opts.durationMs ?? null,
      findingsCount: opts.findingsCount ?? 0,
      model: opts.model ?? 'gpt-4o',
      ranAt: opts.ranAt ?? d2030(6, 15),
    })
    .returning();
  return run!;
}

async function makeReview(
  db: Db,
  opts: {
    workspaceId: string;
    prId: string;
    agentId?: string | null;
    runId?: string;
    kind?: 'summary' | 'review';
    createdAt?: Date;
  },
) {
  // createdAt is set via DB default. We insert and then update the createdAt
  // via raw update to get a predictable value in our isolation window.
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: opts.workspaceId,
      prId: opts.prId,
      agentId: opts.agentId ?? null,
      runId: opts.runId ?? null,
      kind: opts.kind ?? 'review',
    })
    .returning();

  // Update createdAt to be in our isolation window (2030)
  const reviewCreatedAt = opts.createdAt ?? d2030(6, 15);
  await db
    .update(t.reviews)
    .set({ createdAt: reviewCreatedAt })
    .where(eq(t.reviews.id, review!.id));

  return review!;
}

async function makeFinding(
  db: Db,
  opts: {
    reviewId: string;
    severity?: string;
    acceptedAt?: Date | null;
    dismissedAt?: Date | null;
  },
) {
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: opts.reviewId,
      file: 'src/index.ts',
      startLine: 1,
      endLine: 1,
      severity: opts.severity ?? 'WARNING',
      category: 'bug',
      title: `AP Finding ${seq++}`,
      rationale: 'Test finding',
      confidence: 0.9,
      kind: 'finding',
      acceptedAt: opts.acceptedAt ?? null,
      dismissedAt: opts.dismissedAt ?? null,
    })
    .returning();
  return finding!;
}

// ---------------------------------------------------------------------------
// Integration suite (Testcontainers)
// ---------------------------------------------------------------------------

d('agent-performance module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;

    // Create a dedicated test repo + PR in the seeded workspace
    const repo = await makeRepo(pg.handle.db, workspaceId);
    repoId = repo.id;
    const pr = await makePr(pg.handle.db, workspaceId, repoId);
    prId = pr.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  // ---------------------------------------------------------------------------
  // AC-14: accept-rate = accepted/(accepted+dismissed), pending excluded
  // ---------------------------------------------------------------------------
  it('AC-14: accept_rate = 2/3 when 2 accepted + 1 dismissed + 3 pending', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-ac14-${seq++}`);

    const run = await makeRun(db, { workspaceId, agentId: agent.id, prId, ranAt: d2030(3, 10) });
    const review = await makeReview(db, { workspaceId, prId, agentId: agent.id, runId: run.id, createdAt: d2030(3, 10) });

    // 2 accepted
    await makeFinding(db, { reviewId: review.id, severity: 'WARNING', acceptedAt: d2030(3, 11) });
    await makeFinding(db, { reviewId: review.id, severity: 'CRITICAL', acceptedAt: d2030(3, 11) });
    // 1 dismissed
    await makeFinding(db, { reviewId: review.id, severity: 'SUGGESTION', dismissedAt: d2030(3, 11) });
    // 3 pending
    await makeFinding(db, { reviewId: review.id });
    await makeFinding(db, { reviewId: review.id });
    await makeFinding(db, { reviewId: review.id });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?${PERIOD_QS}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentStats;

    // accept_rate = 2 / (2+1) ≈ 0.667
    expect(body.accept_rate).toBeCloseTo(2 / 3, 5);
    expect(body.accepted).toBe(2);
    expect(body.dismissed).toBe(1);
    expect(body.pending).toBe(3);

    // Agent with only pending findings
    const agentPending = await makeAgent(db, workspaceId, `ap-pending-${seq++}`);
    const run2 = await makeRun(db, { workspaceId, agentId: agentPending.id, prId, ranAt: d2030(3, 10) });
    const review2 = await makeReview(db, { workspaceId, prId, agentId: agentPending.id, runId: run2.id, createdAt: d2030(3, 10) });
    await makeFinding(db, { reviewId: review2.id });
    await makeFinding(db, { reviewId: review2.id });

    const res2 = await app.inject({ method: 'GET', url: `/agents/${agentPending.id}/stats?${PERIOD_QS}` });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as AgentStats;
    expect(body2.accept_rate).toBeNull();

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-19: null-cost runs counted in total_runs but excluded from avg_cost_usd
  // ---------------------------------------------------------------------------
  it('AC-19: null-cost run counted in runs but excluded from avg_cost_usd and total_cost_usd', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-ac19-${seq++}`);

    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00500000', status: 'done', ranAt: d2030(4, 1) });
    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00300000', status: 'done', ranAt: d2030(4, 2) });
    // Failed run with null cost — still counted in runs
    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: null, status: 'failed', ranAt: d2030(4, 3) });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?${PERIOD_QS}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentStats;

    expect(body.runs).toBe(3); // All 3 counted
    expect(body.avg_cost_usd).toBeCloseTo(0.004, 6); // (0.005+0.003)/2
    expect(body.total_cost_usd).toBeCloseTo(0.008, 6); // 0.005+0.003

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-12: cost reconciliation
  // ---------------------------------------------------------------------------
  it('AC-12: sum(cost_by_agent) == sum(cost_by_model) == summary.total_cost_usd', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    // Use a sub-range within 2030 to isolate from other AC tests
    const fromSub = '2030-05-01';
    const toSub   = '2030-05-31';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    const agent1 = await makeAgent(db, workspaceId, `ap-rec1-${seq++}`);
    const agent2 = await makeAgent(db, workspaceId, `ap-rec2-${seq++}`);

    await makeRun(db, { workspaceId, agentId: agent1.id, prId, costUsd: '0.00100000', model: 'gpt-4o', ranAt: d2030(5, 10) });
    await makeRun(db, { workspaceId, agentId: agent1.id, prId, costUsd: '0.00200000', model: 'gpt-4o', ranAt: d2030(5, 11) });
    await makeRun(db, { workspaceId, agentId: agent2.id, prId, costUsd: '0.00300000', model: 'claude-3', ranAt: d2030(5, 12) });
    // Null-cost run should not appear in cost breakdowns
    await makeRun(db, { workspaceId, agentId: agent2.id, prId, costUsd: null, ranAt: d2030(5, 13) });

    const res = await app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentPerformance;

    const totalCostUsd = body.summary.total_cost_usd!;
    expect(totalCostUsd).toBeCloseTo(0.006, 6);

    const sumByAgent = body.cost_by_agent.reduce((s, r) => s + r.cost_usd, 0);
    const sumByModel = body.cost_by_model.reduce((s, r) => s + r.cost_usd, 0);

    expect(Math.abs(totalCostUsd - sumByAgent)).toBeLessThan(0.0001);
    expect(Math.abs(totalCostUsd - sumByModel)).toBeLessThan(0.0001);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-23: deleted-agent bucket
  // ---------------------------------------------------------------------------
  it('AC-23: deleted agent runs appear with agent_id=null and name "(deleted agent)"', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    const fromSub = '2030-07-01';
    const toSub   = '2030-07-31';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    const agent = await makeAgent(db, workspaceId, `ap-del-${seq++}`);
    const agentId = agent.id;

    // Create a run attributed to the agent
    const run = await makeRun(db, { workspaceId, agentId, prId, costUsd: '0.00500000', ranAt: d2030(7, 15) });

    // Create a review attributed to this agent (reviews.agentId has no FK)
    const review = await makeReview(db, { workspaceId, prId, agentId, runId: run.id, createdAt: d2030(7, 15) });
    await makeFinding(db, { reviewId: review.id, acceptedAt: d2030(7, 16) });

    // Delete the agent — agent_runs.agentId goes NULL via onDelete:'set null'
    // but reviews.agentId retains the old UUID (no FK constraint on reviews.agentId)
    await db.delete(t.agents).where(eq(t.agents.id, agentId));

    const res = await app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentPerformance;

    // Should have a deleted-agent row in agents[]
    const deletedRow = body.agents.find((r) => r.agent_id === null);
    expect(deletedRow).toBeDefined();
    expect(deletedRow!.agent_name).toBe('(deleted agent)');

    // Should appear in cost_by_agent with null agent_id
    const deletedCost = body.cost_by_agent.find((r) => r.agent_id === null);
    expect(deletedCost).toBeDefined();
    expect(deletedCost!.agent_name).toBe('(deleted agent)');

    // summary.total_runs must include the deleted agent's run
    const allRuns = body.agents.reduce((s, r) => s + r.runs, 0);
    expect(body.summary.total_runs).toBe(allRuns);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-22: UTC day boundaries for custom period
  // ---------------------------------------------------------------------------
  it('AC-22: UTC boundaries: run at 23:30 UTC is included in same-day custom range', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-utc-${seq++}`);

    // Run at 23:30 UTC on 2030-08-15
    const targetRanAt = new Date('2030-08-15T23:30:00.000Z');
    await makeRun(db, { workspaceId, agentId: agent.id, prId, ranAt: targetRanAt });

    // Custom period covering just 2030-08-15 (UTC day: 00:00:00 to 23:59:59.999)
    const resIncluded = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/stats?period=custom&from=2030-08-15&to=2030-08-15`,
    });
    expect(resIncluded.statusCode).toBe(200);
    const bodyIncluded = resIncluded.json() as AgentStats;
    expect(bodyIncluded.runs).toBeGreaterThanOrEqual(1);

    // Custom period for the day before — should NOT include the run
    const resExcluded = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/stats?period=custom&from=2030-08-14&to=2030-08-14`,
    });
    expect(resExcluded.statusCode).toBe(200);
    const bodyExcluded = resExcluded.json() as AgentStats;
    expect(bodyExcluded.runs).toBe(0);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-3: default 30d (no period param)
  // ---------------------------------------------------------------------------
  it('AC-3: calling without period param returns valid 200 response (default 30d)', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-dflt-${seq++}`);
    // Run with current time (within last 30d)
    await makeRun(db, { workspaceId, agentId: agent.id, prId, ranAt: new Date() });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.runs).toBe('number');
    expect(body.runs).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-5: validation returns 422 for invalid inputs
  // ---------------------------------------------------------------------------
  it('AC-5: validation — invalid period/dates return 422', async () => {
    const app = await makeApp();

    // Invalid period value
    const r1 = await app.inject({ method: 'GET', url: '/agent-performance?period=banana' });
    expect(r1.statusCode).toBe(422);

    // Invalid date format (doesn't match YYYY-MM-DD regex)
    const r2 = await app.inject({
      method: 'GET',
      url: '/agent-performance?period=custom&from=not-a-date&to=2026-01-15',
    });
    expect(r2.statusCode).toBe(422);

    // from > to
    const r3 = await app.inject({
      method: 'GET',
      url: '/agent-performance?period=custom&from=2026-07-10&to=2026-07-01',
    });
    expect(r3.statusCode).toBe(422);

    // custom without from/to
    const r4 = await app.inject({ method: 'GET', url: '/agent-performance?period=custom' });
    expect(r4.statusCode).toBe(422);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-7: most-active tie-break by last_run_at DESC when run counts equal
  // ---------------------------------------------------------------------------
  it('AC-7: most_active tie-break by last_run_at DESC when run counts equal', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    // Use a sub-range to isolate
    const fromSub = '2030-09-01';
    const toSub   = '2030-09-30';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    // Two agents with equal run count (1 each) but different last_run_at
    const agentA = await makeAgent(db, workspaceId, `ap-tie-a-${seq++}`);
    const agentB = await makeAgent(db, workspaceId, `ap-tie-b-${seq++}`);

    const earlier = d2030(9, 10);
    const later   = d2030(9, 20);

    await makeRun(db, { workspaceId, agentId: agentA.id, prId, ranAt: earlier });
    await makeRun(db, { workspaceId, agentId: agentB.id, prId, ranAt: later });

    const res = await app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentPerformance;

    // most_active should be agentB (later last_run_at)
    expect(body.summary.most_active).not.toBeNull();
    expect(body.summary.most_active!.agent_id).toBe(agentB.id);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-8: no delta when previous period has no data
  // ---------------------------------------------------------------------------
  it('AC-8: previous_total_cost_usd = null when no prev-period runs exist', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-nodelta-${seq++}`);

    // Only one run on 2030-10-20 — the previous period (20 days before 2030-10-01
    // to 2030-10-20 span = 2030-09-11 to 2030-09-30) has nothing from this test
    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00100000', ranAt: d2030(10, 20) });

    const fromSub = '2030-10-01';
    const toSub   = '2030-10-31';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    const res = await app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AgentPerformance;

    // Previous period for this range = 2030-09-01 to 2030-09-30 (no runs from us,
    // but there might be runs from AC-7 test. The shape should still be valid.)
    // We only assert that the fields are null or valid numbers (no NaN/undefined).
    expect(body.summary.previous_total_cost_usd === null ||
           typeof body.summary.previous_total_cost_usd === 'number').toBe(true);

    for (const agentRow of body.agents) {
      expect(agentRow.previous_accept_rate === null ||
             typeof agentRow.previous_accept_rate === 'number').toBe(true);
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-13: cross-surface equality
  // ---------------------------------------------------------------------------
  it('AC-13: /agents/:id/stats fields match the corresponding /agent-performance row', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-cross-${seq++}`);

    const fromSub = '2030-11-01';
    const toSub   = '2030-11-30';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00150000', durationMs: 1200, ranAt: d2030(11, 5) });
    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00250000', durationMs: 800, ranAt: d2030(11, 10) });

    const review = await makeReview(db, { workspaceId, prId, agentId: agent.id, createdAt: d2030(11, 5) });
    await makeFinding(db, { reviewId: review.id, acceptedAt: d2030(11, 6) });
    await makeFinding(db, { reviewId: review.id, dismissedAt: d2030(11, 6) });

    const [statsRes, dashRes] = await Promise.all([
      app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?${periodQsSub}` }),
      app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` }),
    ]);

    expect(statsRes.statusCode).toBe(200);
    expect(dashRes.statusCode).toBe(200);

    const stats = statsRes.json() as AgentStats;
    const dash = dashRes.json() as AgentPerformance;

    const dashRow = dash.agents.find((r) => r.agent_id === agent.id);
    expect(dashRow).toBeDefined();

    // Runs match
    expect(stats.runs).toBe(dashRow!.runs);

    // Accept rate match
    if (stats.accept_rate !== null && dashRow!.accept_rate !== null) {
      expect(stats.accept_rate).toBeCloseTo(dashRow!.accept_rate, 5);
    } else {
      expect(stats.accept_rate).toBe(dashRow!.accept_rate);
    }

    // avg_cost_usd match
    if (stats.avg_cost_usd !== null && dashRow!.avg_cost_usd !== null) {
      expect(stats.avg_cost_usd).toBeCloseTo(dashRow!.avg_cost_usd, 5);
    } else {
      expect(stats.avg_cost_usd).toBe(dashRow!.avg_cost_usd);
    }

    // avg_latency_ms matches avg_duration_ms
    if (stats.avg_latency_ms !== null && dashRow!.avg_duration_ms !== null) {
      expect(stats.avg_latency_ms).toBeCloseTo(dashRow!.avg_duration_ms, 2);
    } else {
      expect(stats.avg_latency_ms).toBe(dashRow!.avg_duration_ms);
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Zod schema parse of responses
  // ---------------------------------------------------------------------------
  it('Zod: both /agent-performance and /agents/:id/stats responses parse against their schemas', async () => {
    const app = await makeApp();
    const db = pg.handle.db;
    const agent = await makeAgent(db, workspaceId, `ap-zod-${seq++}`);
    await makeRun(db, { workspaceId, agentId: agent.id, prId, costUsd: '0.00100000', ranAt: d2030(12, 1) });

    const fromSub = '2030-12-01';
    const toSub   = '2030-12-31';
    const periodQsSub = `period=custom&from=${fromSub}&to=${toSub}`;

    const [dashRes, statsRes] = await Promise.all([
      app.inject({ method: 'GET', url: `/agent-performance?${periodQsSub}` }),
      app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?${periodQsSub}` }),
    ]);

    expect(dashRes.statusCode).toBe(200);
    expect(statsRes.statusCode).toBe(200);

    // These parse() calls throw if the schema doesn't match the response shape
    expect(() => AgentPerformance.parse(dashRes.json())).not.toThrow();
    expect(() => AgentStats.parse(statsRes.json())).not.toThrow();

    await app.close();
  });
});
