/**
 * BriefTimeline — pr_brief moves from one-row-per-PR to one-row-per-(pr_id,
 * head_sha), so prior generations are retained instead of overwritten.
 * Exercises the real upsert-conflict-target behavior (which a mocked DB
 * cannot verify): regenerating at an unchanged head SHA updates that SHA's
 * row in place, while a new head SHA appends a new history row.
 * Docker-gated (needs Postgres), like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';
import type { BriefTimeline } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const EMPTY_BLAST: BlastResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  factsByFile: {},
  degraded: false,
};

const mockRepoIntel = { getBlastRadius: async () => EMPTY_BLAST } as unknown as RepoIntel;

const BRIEF_FIXTURE = {
  what: 'Adds rate limiting middleware.',
  why: 'Prevents abuse of unauthenticated endpoints.',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, headSha: string) {
  const name = `brief-history-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rate-limit',
      base: 'main',
      headSha,
      additions: 10,
      deletions: 2,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

d('brief history (BriefTimeline) — Testcontainers pg', () => {
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

  it('regenerating at an unchanged head SHA updates the row in place; a new commit appends history', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { BriefLlmOutput: BRIEF_FIXTURE },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel: mockRepoIntel, llm: { openai: llm } },
    });
    const pr = await setupRepoAndPr(pg.handle.db, workspaceId, 'sha-1');

    // No brief yet — empty history.
    const empty = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/history` });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as BriefTimeline).entries).toEqual([]);

    // First generation at sha-1.
    const gen1 = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ force: true }),
    });
    expect(gen1.statusCode).toBe(200);

    const afterFirst = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/history` })
    ).json() as BriefTimeline;
    expect(afterFirst.entries).toHaveLength(1);
    expect(afterFirst.entries[0]!.head_sha).toBe('sha-1');

    // Regenerate again at the SAME head SHA — updates in place, no new row.
    const gen2 = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ force: true }),
    });
    expect(gen2.statusCode).toBe(200);

    const afterSecond = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/history` })
    ).json() as BriefTimeline;
    expect(afterSecond.entries).toHaveLength(1);
    expect(afterSecond.entries[0]!.head_sha).toBe('sha-1');

    // Simulate a new commit — PR's head SHA moves to sha-2.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-2' })
      .where(eq(t.pullRequests.id, pr.id));

    // Regenerate at the new head SHA — appends a new history row.
    const gen3 = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ force: true }),
    });
    expect(gen3.statusCode).toBe(200);

    const afterThird = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/history` })
    ).json() as BriefTimeline;
    expect(afterThird.entries).toHaveLength(2);
    // Newest first.
    expect(afterThird.entries[0]!.head_sha).toBe('sha-2');
    expect(afterThird.entries[1]!.head_sha).toBe('sha-1');

    await app.close();
  });

  it('GET /pulls/:id/brief/history returns 404 for an unknown PR', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { BriefLlmOutput: BRIEF_FIXTURE },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel: mockRepoIntel, llm: { openai: llm } },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/brief/history`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
