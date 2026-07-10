import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// A unified diff touching src/config.ts (line 11) so grounding can keep the finding.
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

// Review fixture: one valid finding on line 11 (kept by grounding).
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
  ],
};

let repoSeq = 0;
type Db = PgFixture['handle']['db'];

/** Create a fresh repo+PR+pr_files row. Pass withFiles=false to omit the patch. */
async function setupRepoAndPr(
  db: Db,
  workspaceId: string,
  opts: { withFiles?: boolean } = {},
) {
  const { withFiles = true } = opts;
  const name = `eval-test-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Closes #1.',
    })
    .returning();
  if (withFiles) {
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
  }
  return { repo: repo!, pr: pr! };
}

d('A4 POST /findings/:id/eval-case (Testcontainers pg)', () => {
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

  // ---------------------------------------------------------------------------
  // AC-1: accepted finding → 201 + must_find case
  // ---------------------------------------------------------------------------
  it('AC-1: accepted finding → 201 with kind=must_find', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'EvalAgent-1', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const findingId: string = reviews[0].findings[0].id;

    // Accept the finding
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    // Create the eval case
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.expected_output.kind).toBe('must_find');
    expect(body.expected_output.finding.file).toBe('src/config.ts');
    expect(body.expected_output.finding.start_line).toBe(11);
    expect(body.agent_id).toBe(agent.id);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-2: dismissed finding → 201 + must_not_flag case
  // ---------------------------------------------------------------------------
  it('AC-2: dismissed finding → 201 with kind=must_not_flag', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'EvalAgent-2', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const findingId: string = reviews[0].findings[0].id;

    // Dismiss the finding
    await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.expected_output.kind).toBe('must_not_flag');

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-3: review with agentId=null → 422
  // ---------------------------------------------------------------------------
  it('AC-3: review with null agentId → 422', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Insert a review with agentId=null directly
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'Test review',
        score: 50,
        model: 'test-model',
      })
      .returning();

    // Insert a finding with acceptedAt set (to pass the state guard)
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        rationale: 'Secret in source.',
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date(),
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/eval-case` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-3a: no pr_files entry → 422
  // ---------------------------------------------------------------------------
  it('AC-3a: missing pr_files entry (no patch) → 422', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    // PR without pr_files
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { withFiles: false });

    // Create a real agent (so we have a valid agentId)
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'EvalAgent-3a', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    // Insert review with valid agentId
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: agent.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'Test review',
        score: 50,
        model: 'gpt-4.1',
      })
      .returning();

    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        rationale: 'Secret in source.',
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date(),
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/eval-case` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-3b: finding with both accepted_at and dismissed_at → 422
  // ---------------------------------------------------------------------------
  it('AC-3b: finding with both accepted_at and dismissed_at set → 422', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'Test',
        score: 50,
        model: 'test',
      })
      .returning();

    // Insert finding with BOTH timestamps set (ambiguous state)
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        rationale: 'Secret in source.',
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: new Date(),
        dismissedAt: new Date(),
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/eval-case` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // AC-4: non-existent finding → 404
  // ---------------------------------------------------------------------------
  it('AC-4: unknown finding id → 404', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const res = await app.inject({
      method: 'POST',
      url: '/findings/00000000-0000-0000-0000-000000000000/eval-case',
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
