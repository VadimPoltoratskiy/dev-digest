/**
 * Prior-PRs routes — GET /pulls/:id/files/prior-prs (SPEC-06).
 * Read-only DB join over prFiles + pullRequests; no adapters to mock. Gated on
 * Docker (needs Postgres for repo/PR rows), matching the other integration
 * tests (see test/blast.it.test.ts for the same pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PriorPrList } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `prior-prs-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

let prSeq = 0;
async function makePr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  opts: {
    path?: string;
    openedAt?: Date;
    author?: string;
    title?: string;
    status?: string;
  } = {},
) {
  const number = 1000 + prSeq++;
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: opts.title ?? `PR ${number}`,
      author: opts.author ?? 'alice',
      branch: `feat/${number}`,
      base: 'main',
      headSha: `sha${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: opts.status ?? 'reviewed',
      openedAt: opts.openedAt ?? new Date(),
    })
    .returning();
  if (opts.path) {
    await db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: opts.path, additions: 1, deletions: 0, patch: null });
  }
  return pr!;
}

d('prior-prs routes (Testcontainers pg)', () => {
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

  it('AC-1/AC-2: returns only same-repo PRs touching the path, excluding the current PR', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const prA = await makePr(pg.handle.db, workspaceId, repo.id, {
      path: 'src/foo.ts',
      openedAt: new Date('2026-01-03'),
    });
    const prB = await makePr(pg.handle.db, workspaceId, repo.id, {
      path: 'src/foo.ts',
      openedAt: new Date('2026-01-02'),
      author: 'bob',
      title: 'Older change to foo',
    });
    await makePr(pg.handle.db, workspaceId, repo.id, {
      path: 'src/bar.ts',
      openedAt: new Date('2026-01-01'),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${prA.id}/files/prior-prs?path=src/foo.ts`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PriorPrList;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.number).toBe(prB.number);
    expect(body.items[0]!.title).toBe('Older change to foo');
    expect(body.items[0]!.author).toBe('bob');
    expect(body.items[0]!.status).toBe('reviewed');
    expect(body.items[0]!.opened_at).toBeTruthy();
    expect(body.total).toBe(1);
    await app.close();
  });

  it('AC-3: returns an empty list (not an error) when no PR touches the path', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, { path: 'src/only.ts' });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/files/prior-prs?path=src/never-touched.ts`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PriorPrList;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });

  it('AC-4: returns 404 for a PR id that does not exist', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/files/prior-prs?path=src/foo.ts`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('AC-5: returns 422 when path is missing or empty', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, { path: 'src/foo.ts' });

    const missing = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/files/prior-prs` });
    expect(missing.statusCode).toBe(422);

    const empty = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/files/prior-prs?path=`,
    });
    expect(empty.statusCode).toBe(422);
    await app.close();
  });

  it('AC-1a: caps items at 10 and reports the full pre-cap total, newest first', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const current = await makePr(pg.handle.db, workspaceId, repo.id, {
      path: 'src/hotspot.ts',
      openedAt: new Date('2026-01-01'),
    });
    // 11 more PRs touching the same file — 12 total, 11 besides the current one.
    for (let i = 0; i < 11; i++) {
      await makePr(pg.handle.db, workspaceId, repo.id, {
        path: 'src/hotspot.ts',
        openedAt: new Date(2026, 1, i + 1),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${current.id}/files/prior-prs?path=src/hotspot.ts`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PriorPrList;
    expect(body.items).toHaveLength(10);
    expect(body.total).toBe(11);

    const openedDates = body.items.map((i) => new Date(i.opened_at!).getTime());
    const sorted = [...openedDates].sort((a, b) => b - a);
    expect(openedDates).toEqual(sorted);
    await app.close();
  });
});
