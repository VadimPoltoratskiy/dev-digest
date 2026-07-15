import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockSecretsProvider,
} from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Diff whose hunk covers src/config.ts lines 10-12.
 * The finding fixture below uses end_line: 11 — in diff → passes the filter.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A second diff that covers only src/other.ts — so src/config.ts is out-of-diff. */
const DIFF_OTHER_FILE = `diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;`;

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

async function setupRepoAndPr(db: Db, workspaceId: string, opts?: { patch?: string }) {
  const name = `compose-test-repo-${repoSeq++}`;
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
    patch:
      opts?.patch ??
      '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('POST /pulls/:id/compose-review (Testcontainers pg)', () => {
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

  /** Seed a finding via a real review run; returns its ID. */
  async function seedFinding(diff = DIFF): Promise<{ findingId: string; prId: string }> {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ComposeAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    await app.close();
    return { findingId: reviews[0].findings[0].id, prId: pr.id };
  }

  it('happy path: posts a composed review via the GitHub adapter (no inline comments)', async () => {
    const gh = new MockGitHubClient();
    const { prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh, git: new MockGitClient({ diff: DIFF }) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'COMMENT', body: 'Overall LGTM.', finding_ids: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.github_review_id).toMatch(/^mock-review-/);
    expect(body.omitted_count).toBeUndefined();

    // Verify the mock captured the right call
    expect(gh.posted).toHaveLength(1);
    expect(gh.posted[0]!.review.event).toBe('COMMENT');
    expect(gh.posted[0]!.review.body).toBe('Overall LGTM.');
    expect(gh.posted[0]!.review.comments).toBeUndefined();

    await app.close();
  });

  it('happy path: posts with inline comments for in-diff findings', async () => {
    const gh = new MockGitHubClient();
    const { findingId, prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh, git: new MockGitClient({ diff: DIFF }) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'REQUEST_CHANGES', body: 'Please fix.', finding_ids: [findingId] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.github_review_id).toMatch(/^mock-review-/);
    expect(body.omitted_count).toBeUndefined(); // in-diff finding, no omissions

    expect(gh.posted).toHaveLength(1);
    expect(gh.posted[0]!.review.event).toBe('REQUEST_CHANGES');
    expect(gh.posted[0]!.review.comments).toHaveLength(1);
    expect(gh.posted[0]!.review.comments![0]).toMatchObject({
      path: 'src/config.ts',
      line: 11,
    });
    // Body contains severity + title + suggestion
    expect(gh.posted[0]!.review.comments![0]!.body).toContain('CRITICAL');
    expect(gh.posted[0]!.review.comments![0]!.body).toContain('Hardcoded Stripe secret key');
    expect(gh.posted[0]!.review.comments![0]!.body).toContain('Move the key to an environment variable');

    await app.close();
  });

  it('out-of-diff finding: omits its comment and reports omitted_count', async () => {
    const gh = new MockGitHubClient();
    // Seed the finding using the normal diff (covers src/config.ts:11) so the
    // grounding gate keeps it. Then during compose, present a diff that only
    // covers src/other.ts — the finding becomes out-of-diff from compose's view.
    const { findingId, prId } = await seedFinding(DIFF);
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh, git: new MockGitClient({ diff: DIFF_OTHER_FILE }) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'COMMENT', body: 'See notes.', finding_ids: [findingId] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.github_review_id).toMatch(/^mock-review-/);
    expect(body.omitted_count).toBe(1);

    // postReview was still called (without the out-of-diff comment)
    expect(gh.posted).toHaveLength(1);
    expect(gh.posted[0]!.review.comments).toBeUndefined();

    await app.close();
  });

  it('missing PR → 404', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/pulls/00000000-0000-0000-0000-000000000000/compose-review',
      payload: { verdict: 'COMMENT', body: '', finding_ids: [] },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('no GitHub token configured → 400 github_unavailable', async () => {
    const { prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'APPROVE', body: 'LGTM', finding_ids: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('github_unavailable');

    await app.close();
  });

  it('finding_ids from a different PR → 404 (workspace scope guard)', async () => {
    const gh = new MockGitHubClient();
    // Seed two PRs; get finding from PR-1, try to use it on PR-2
    const { findingId } = await seedFinding();
    const { pr: pr2 } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh, git: new MockGitClient({ diff: DIFF }) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr2.id}/compose-review`,
      payload: { verdict: 'COMMENT', body: 'test', finding_ids: [findingId] },
    });
    expect(res.statusCode).toBe(404);
    expect(gh.posted).toHaveLength(0); // GitHub was never called

    await app.close();
  });

  it('invalid body (missing verdict) → 422', async () => {
    const { prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { body: 'test', finding_ids: [] }, // verdict missing
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('invalid body (invalid verdict value) → 422', async () => {
    const { prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'APPROVE_ALL', body: 'test', finding_ids: [] },
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('empty finding_ids → success (AC-15: body-only review)', async () => {
    const gh = new MockGitHubClient();
    const { prId } = await seedFinding();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh, git: new MockGitClient({ diff: DIFF }) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/compose-review`,
      payload: { verdict: 'APPROVE', body: 'LGTM', finding_ids: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().github_review_id).toMatch(/^mock-review-/);
    expect(gh.posted[0]!.review.event).toBe('APPROVE');
    expect(gh.posted[0]!.review.comments).toBeUndefined();

    await app.close();
  });
});
