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

// A unified diff touching src/config.ts (line 11) so grounding keeps line-11 finding.
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

// Review fixture: two findings. The grounding gate keeps line 11 (in the diff),
// drops line 999 (not in the diff). This gives 1 kept + 1 dropped per call.
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

type Db = PgFixture['handle']['db'];
let repoSeq = 0;

/** Insert an eval case directly so tests can control expected_output precisely. */
async function insertEvalCase(
  db: Db,
  opts: {
    workspaceId: string;
    agentId: string;
    name: string;
    kind: 'must_find' | 'must_not_flag';
    file: string;
    startLine: number;
    endLine: number;
    inputDiff?: string;
  },
) {
  const expectedOutput = {
    kind: opts.kind,
    finding: {
      file: opts.file,
      start_line: opts.startLine,
      end_line: opts.endLine,
      title: opts.name,
      severity: 'CRITICAL',
      category: 'security',
    },
  };
  const [row] = await db
    .insert(t.evalCases)
    .values({
      workspaceId: opts.workspaceId,
      ownerKind: 'agent',
      ownerId: opts.agentId,
      name: opts.name,
      inputDiff: opts.inputDiff ?? DIFF,
      expectedOutput,
    })
    .returning();
  return row!;
}

d('A4 POST /agents/:id/eval-runs (Testcontainers pg)', () => {
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

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  /** Create an agent via the API and return its id. */
  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, suffix: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `EvalRunAgent-${suffix}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json() as { id: string };
  }

  // ---------------------------------------------------------------------------
  // AC-13: zero cases → all metrics null, empty per_trace
  // ---------------------------------------------------------------------------
  it('AC-13: agent with no eval cases returns null metrics and empty per_trace', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = await createAgent(app, 'ac13');

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.recall).toBeNull();
    expect(body.precision).toBeNull();
    expect(body.citation_accuracy).toBeNull();
    expect(body.per_trace).toHaveLength(0);
    expect(body.traces_total).toBe(0);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-5/6/7: recall, precision, citation_accuracy
  //
  // Setup:
  //   Case A (must_find): file=src/config.ts line 11
  //     → grounding keeps finding on line 11 → scoreMustFind → pass=true
  //     → recall: 1/1 = 1.0
  //   Case B (must_not_flag): file=src/other.ts line 1
  //     → agent never produces src/other.ts → scoreMustNotFlag → pass=true
  //     → precision: 1/1 = 1.0
  //
  //   citation_accuracy = total_kept / (total_kept + total_dropped)
  //     = (1+1) / (1+1+1+1) = 2/4 = 0.5 (each call: 1 kept + 1 dropped)
  // ---------------------------------------------------------------------------
  it('AC-5/6/7: recall=1.0, precision=1.0, citation_accuracy=0.5 with two well-crafted cases', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = await createAgent(app, 'ac567');

    // must_find on line 11 (which the agent finds) → pass=true
    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Must find stripe key',
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    // must_not_flag on a file the agent never touches → pass=true
    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Must not flag other.ts',
      kind: 'must_not_flag',
      file: 'src/other.ts',
      startLine: 1,
      endLine: 1,
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.recall).toBeCloseTo(1.0);
    expect(body.precision).toBeCloseTo(1.0);
    // Each call: 1 kept + 1 dropped → 2 total kept, 4 total candidates
    expect(body.citation_accuracy).toBeCloseTo(0.5);
    expect(body.traces_passed).toBe(2);
    expect(body.traces_total).toBe(2);

    // Verify the eval_runs rows have denormalized metrics
    const runRows = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(runRows.length).toBeGreaterThanOrEqual(2);
    // All rows in the batch share the same metrics
    for (const row of runRows) {
      expect(row.recall).toBeCloseTo(1.0);
      expect(row.precision).toBeCloseTo(1.0);
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-11: single ran_at timestamp shared across all rows in the batch
  // ---------------------------------------------------------------------------
  it('AC-11: all eval_run rows from one batch share the same ran_at timestamp', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = await createAgent(app, 'ac11');

    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Case X',
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Case Y',
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const batchRanAt: string = res.json().ran_at;

    const runRows = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
    // All rows should share the batch's ran_at timestamp
    for (const row of runRows) {
      expect(row.ran_at).toBe(batchRanAt);
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-12: per-case LLM error doesn't abort the batch
  //
  // Strategy: monkey-patch the MockLLMProvider to throw on the first call only.
  // The second case's LLM call succeeds → batch completes, first case has pass=false.
  // ---------------------------------------------------------------------------
  it('AC-12: LLM error on one case marks it failed but does not abort the batch', async () => {
    // Build a normal mock, then intercept the first call to throw
    const goodMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    let callCount = 0;
    const origMethod = (goodMock as unknown as Record<string, unknown>).completeStructured as (
      req: unknown,
    ) => Promise<unknown>;
    (goodMock as unknown as Record<string, unknown>).completeStructured = async (req: unknown) => {
      if (callCount++ === 0) {
        throw new Error('Simulated LLM failure (AC-12 test)');
      }
      return origMethod.call(goodMock, req);
    };

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: goodMock },
      },
    });

    const agent = await createAgent(app, 'ac12');

    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Case-fail',
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    await insertEvalCase(pg.handle.db, {
      workspaceId,
      agentId: agent.id,
      name: 'Case-ok',
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.traces_total).toBe(2);

    // One trace errored → pass=false, one succeeded
    const failedTrace = (body.per_trace as Array<{ pass: boolean; error?: string }>).find(
      (t) => t.error != null,
    );
    expect(failedTrace).toBeDefined();
    expect(failedTrace!.pass).toBe(false);
    expect(failedTrace!.error).toContain('Simulated LLM failure');

    // The second trace should have succeeded (no error key)
    const succeededTrace = (body.per_trace as Array<{ pass: boolean; error?: string }>).find(
      (t) => t.error == null,
    );
    expect(succeededTrace).toBeDefined();

    await app.close();
  });
});
