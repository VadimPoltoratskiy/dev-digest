/**
 * Optional AI blast explanation — GET /pulls/:id/blast/explanation and
 * POST /pulls/:id/blast/explain. The one LLM call in the feature is mocked;
 * we assert it fires exactly once on POST, is persisted, is served from the
 * cache on GET (zero further model calls), and 404s for an unknown PR.
 * Docker-gated (needs Postgres), like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';
import type { BlastExplanation } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PERSISTENT: BlastResult = {
  changedSymbols: [{ file: 'src/shared/helper.ts', name: 'rateLimit', kind: 'function' }],
  callers: [
    { file: 'src/api/public/index.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 5 },
    { file: 'src/api/public/webhooks.ts', symbol: 'webhook', viaSymbol: 'rateLimit', line: 45, rank: 3 },
  ],
  impactedEndpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
  factsByFile: {
    'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/api/public/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: [] },
  },
  degraded: false,
};

const mockRepoIntel = { getBlastRadius: async () => PERSISTENT } as unknown as RepoIntel;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-explain-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 12,
      title: 'Change shared helper',
      author: 'marisa.koch',
      branch: 'feat/helper',
      base: 'main',
      headSha: 'deadbeef',
      additions: 2,
      deletions: 1,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: 'src/shared/helper.ts', additions: 2, deletions: 1, patch: null });
  return pr!;
}

d('blast explanation routes (Testcontainers pg)', () => {
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

  it('POST generates + persists the explanation with exactly one model call; GET serves it cached', async () => {
    const llm = new MockLLMProvider('anthropic', { completionText: 'This PR changes the shared rateLimit helper, which two public API handlers call.' });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel: mockRepoIntel, llm: { anthropic: llm } },
    });
    const pr = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Before any generate: cached explanation is null, no model call made.
    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast/explanation` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toBeNull();
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);

    // POST → one model call, returns the paragraph.
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/explain` });
    expect(gen.statusCode).toBe(200);
    const body = gen.json() as BlastExplanation;
    expect(body.explanation).toContain('rateLimit');
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.tokens_in).toBe(100);
    expect(body.cost_usd).toBe(0.001);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(1);

    // GET now returns the cached record — NO additional model call.
    const cached = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast/explanation` });
    expect(cached.statusCode).toBe(200);
    expect((cached.json() as BlastExplanation).explanation).toBe(body.explanation);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(1);

    await app.close();
  });

  it('POST /pulls/:id/blast/explain returns 404 for an unknown PR (no model call)', async () => {
    const llm = new MockLLMProvider('anthropic', { completionText: 'x' });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel: mockRepoIntel, llm: { anthropic: llm } },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/00000000-0000-0000-0000-000000000000/blast/explain`,
    });
    expect(res.statusCode).toBe(404);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);
    await app.close();
  });
});
