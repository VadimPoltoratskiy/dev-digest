import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockGitHubClient, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

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

async function setupRepoAndPr(db: Db, workspaceId: string) {
  const name = `reply-test-repo-${repoSeq++}`;
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
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('POST /findings/:id/reply (Testcontainers pg)', () => {
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

  async function seedFinding(): Promise<{ findingId: string }> {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ReplyAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    await app.close();
    return { findingId: reviews[0].findings[0].id };
  }

  it('happy path: posts a review comment via the GitHub adapter', async () => {
    const { findingId } = await seedFinding();
    const gh = new MockGitHubClient();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/reply`,
      payload: { reply: 'Please rotate this key before merging.' },
    });
    expect(res.statusCode).toBe(200);

    expect(gh.createdComments).toHaveLength(1);
    expect(gh.createdComments[0]).toMatchObject({
      path: 'src/config.ts',
      line: 11,
      side: 'RIGHT',
      commitId: 'a1b2c3d4',
      body: 'Please rotate this key before merging.',
    });

    const body = res.json();
    expect(body.comment.body).toBe('Please rotate this key before merging.');

    await app.close();
  });

  it('missing finding → 404', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/findings/00000000-0000-0000-0000-000000000000/reply',
      payload: { reply: 'hello' },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('no GitHub token configured → 400 github_unavailable', async () => {
    const { findingId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/reply`,
      payload: { reply: 'hello' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('github_unavailable');

    await app.close();
  });

  it('missing reply text in body → 422', async () => {
    const { findingId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/reply`, payload: {} });
    expect(res.statusCode).toBe(422);

    await app.close();
  });
});
