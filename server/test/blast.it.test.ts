/**
 * Blast radius routes — GET /pulls/:id/blast and POST /repos/:id/blast.
 * The repoIntel facade is mocked (the index build is out of scope here); we
 * assert the routes resolve tenancy, feed the changed files to the facade, and
 * map BlastResult → BlastRadius. Gated on Docker (needs Postgres for the repo +
 * PR rows), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';
import type { BlastRadius } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Minimal RepoIntel mock — only getBlastRadius is exercised by these routes. */
function mockRepoIntel(
  onCall: (repoId: string, changedFiles: string[]) => BlastResult,
): { intel: RepoIntel; calls: { repoId: string; files: string[] }[] } {
  const calls: { repoId: string; files: string[] }[] = [];
  const intel = {
    getBlastRadius: async (repoId: string, changedFiles: string[]) => {
      calls.push({ repoId, files: changedFiles });
      return onCall(repoId, changedFiles);
    },
  } as unknown as RepoIntel;
  return { intel, calls };
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 11,
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
  return { repo: repo!, pr: pr! };
}

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

d('blast routes (Testcontainers pg)', () => {
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

  it('GET /pulls/:id/blast maps the facade result and passes the PR changed files', async () => {
    const { intel, calls } = mockRepoIntel(() => PERSISTENT);
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { repoIntel: intel } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;

    expect(calls).toHaveLength(1);
    expect(calls[0]!.files).toEqual(['src/shared/helper.ts']);
    expect(body.changed_symbols).toHaveLength(1);
    expect(body.downstream[0]!.callers).toHaveLength(2);
    expect(body.downstream[0]!.endpoints_affected.length).toBeGreaterThanOrEqual(1);
    expect(body.degraded).toBeUndefined();
    await app.close();
  });

  it('GET /pulls/:id/blast returns 404 for an unknown PR', async () => {
    const { intel } = mockRepoIntel(() => PERSISTENT);
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { repoIntel: intel } });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/blast`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /repos/:id/blast maps a degraded result and forwards the supplied files', async () => {
    const degraded: BlastResult = {
      changedSymbols: [{ file: 'src/x.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'y.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 0 }],
      impactedEndpoints: ['GET /a'],
      degraded: true,
      reason: 'no_data',
    };
    const { intel, calls } = mockRepoIntel(() => degraded);
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { repoIntel: intel } });
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/blast`,
      payload: { files: ['src/x.ts'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;
    expect(calls[0]!.files).toEqual(['src/x.ts']);
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('no_data');
    await app.close();
  });

  it('POST /repos/:id/blast returns 404 for an unknown repo', async () => {
    const { intel } = mockRepoIntel(() => PERSISTENT);
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { repoIntel: intel } });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/00000000-0000-0000-0000-000000000000/blast`,
      payload: { files: ['src/x.ts'] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
