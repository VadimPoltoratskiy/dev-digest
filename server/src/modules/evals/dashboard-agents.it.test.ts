import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

type Db = PgFixture['handle']['db'];

/** Insert an eval case directly, bypassing the API, for direct DB control in tests. */
async function insertEvalCase(db: Db, workspaceId: string, agentId: string, name: string) {
  const [row] = await db
    .insert(t.evalCases)
    .values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name,
      inputDiff: '',
      expectedOutput: { kind: 'must_not_flag', finding: { file: 'x', start_line: 1, end_line: 1, title: name, severity: 'CRITICAL', category: 'security' } },
    })
    .returning();
  return row!;
}

/** Insert an eval_run row with pre-set (already-scored) batch metrics, bypassing the review pipeline. */
async function insertScoredRun(
  db: Db,
  caseId: string,
  ranAt: Date,
  metrics: { recall: number; precision: number; citationAccuracy: number },
) {
  await db.insert(t.evalRuns).values({
    caseId,
    ranAt,
    actualOutput: {},
    pass: true,
    recall: metrics.recall,
    precision: metrics.precision,
    citationAccuracy: metrics.citationAccuracy,
    durationMs: 100,
    costUsd: 0.01,
  });
}

d('A4 GET /evals/dashboard/agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, suffix: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `DashAgent-${suffix}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json() as { id: string; version: number };
  }

  it('returns one row per agent, with correct cases_total/current/last_ran_at, and current:null/trend:[] for an agent with no cases', async () => {
    const app = await appWith();

    const withRuns = await createAgent(app, 'with-runs');
    const withoutCases = await createAgent(app, 'no-cases');

    const evalCase = await insertEvalCase(pg.handle.db, workspaceId, withRuns.id, 'Case A');
    const ranAt = new Date();
    await insertScoredRun(pg.handle.db, evalCase.id, ranAt, {
      recall: 0.9,
      precision: 0.95,
      citationAccuracy: 0.92,
    });

    const res = await app.inject({ method: 'GET', url: '/evals/dashboard/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      agent_id: string;
      cases_total: number;
      current: { recall: number; precision: number; citation_accuracy: number } | null;
      trend: number[];
      last_ran_at: string | null;
    }>;

    const withRunsRow = body.find((r) => r.agent_id === withRuns.id);
    expect(withRunsRow).toBeDefined();
    expect(withRunsRow!.cases_total).toBe(1);
    expect(withRunsRow!.current).toEqual({ recall: 0.9, precision: 0.95, citation_accuracy: 0.92 });
    expect(withRunsRow!.trend).toEqual([0.9]);
    expect(withRunsRow!.last_ran_at).not.toBeNull();

    const withoutCasesRow = body.find((r) => r.agent_id === withoutCases.id);
    expect(withoutCasesRow).toBeDefined();
    expect(withoutCasesRow!.cases_total).toBe(0);
    expect(withoutCasesRow!.current).toBeNull();
    expect(withoutCasesRow!.trend).toEqual([]);
    expect(withoutCasesRow!.last_ran_at).toBeNull();

    await app.close();
  });

  it('GET /evals/dashboard?owner_id= returns a non-null alert after a >=2pt regression between two batches', async () => {
    const app = await appWith();
    const agent = await createAgent(app, 'regression');
    const evalCase = await insertEvalCase(pg.handle.db, workspaceId, agent.id, 'Case B');

    const older = new Date(Date.now() - 60_000);
    const newer = new Date();

    await insertScoredRun(pg.handle.db, evalCase.id, older, {
      recall: 0.9,
      precision: 0.93,
      citationAccuracy: 0.94,
    });
    // Precision regresses by 4pts on the newer batch.
    await insertScoredRun(pg.handle.db, evalCase.id, newer, {
      recall: 0.9,
      precision: 0.89,
      citationAccuracy: 0.94,
    });

    const res = await app.inject({ method: 'GET', url: `/evals/dashboard?owner_id=${agent.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.alert).toBeTypeOf('string');
    expect(body.alert).toContain('Precision dipped 4pts');
    expect(body.alert).toContain(`on v${agent.version}`);

    await app.close();
  });

  it('GET /evals/dashboard (workspace-wide, no owner_id) never sets an alert', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/evals/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.json().alert).toBeNull();
    await app.close();
  });
});
