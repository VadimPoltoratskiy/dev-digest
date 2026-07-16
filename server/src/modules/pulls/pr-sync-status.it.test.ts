/**
 * pr-sync-status.it.test.ts — DB-backed integration tests for the PR-list
 * sync bookkeeping (repos.pr_synced_at / repos.pr_sync_error).
 *
 * Uses testcontainers (pgvector/pg16) via test/helpers/pg.ts.
 * Self-skips when Docker is unavailable.
 *
 * Covers (route-level via app.inject):
 *   GET /repos/:id/pulls  — successful sync stamps pr_synced_at, clears error
 *   GET /repos/:id/pulls  — failing sync records pr_sync_error, keeps rows
 *                           serving and keeps the previous pr_synced_at
 *   GET /repos            — Repo DTO exposes pr_synced_at / pr_sync_error
 *   POST /repos/:id/poll  — failure records pr_sync_error and still 5xx's
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { PrMeta, RepoRef, Repo } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** GitHub client whose PR list always fails — simulates an outage / bad token. */
class OutageGitHubClient extends MockGitHubClient {
  override async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    throw new Error('GitHub API 503 (partial outage)');
  }
}

d('PR sync status bookkeeping', () => {
  let pg: PgFixture;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos).limit(1);
    repoId = repo!.id;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp(github: MockGitHubClient = new MockGitHubClient()) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github,
      },
    });
  }

  async function repoRow() {
    const [row] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row!;
  }

  it('successful sync stamps pr_synced_at and clears pr_sync_error', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);

    const row = await repoRow();
    expect(row.prSyncedAt).not.toBeNull();
    expect(row.prSyncError).toBeNull();
  });

  it('failing sync records pr_sync_error, keeps pr_synced_at, and still serves persisted rows', async () => {
    // Establish a healthy baseline first.
    const healthy = await makeApp();
    await healthy.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    const before = await repoRow();
    expect(before.prSyncedAt).not.toBeNull();

    const app = await makeApp(new OutageGitHubClient());
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });

    // Local-first: the read must not fail — persisted PRs stay viewable.
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);

    const row = await repoRow();
    expect(row.prSyncError).toContain('503');
    // The last SUCCESSFUL sync time is preserved, not overwritten.
    expect(row.prSyncedAt?.toISOString()).toBe(before.prSyncedAt?.toISOString());
  });

  it('recovery clears the recorded error on the next successful sync', async () => {
    // Start from the failed state left by the previous test (order-dependent
    // within this describe), then sync successfully.
    const app = await makeApp();
    await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });

    const row = await repoRow();
    expect(row.prSyncError).toBeNull();
    expect(row.prSyncedAt).not.toBeNull();
  });

  it('GET /repos exposes pr_synced_at and pr_sync_error on the Repo DTO', async () => {
    const app = await makeApp();
    await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });

    const res = await app.inject({ method: 'GET', url: '/repos' });
    expect(res.statusCode).toBe(200);
    const repos = res.json() as Repo[];
    const dto = repos.find((r) => r.id === repoId)!;
    expect(dto.pr_sync_error).toBeNull();
    expect(typeof dto.pr_synced_at).toBe('string');
  });

  it('POST /repos/:id/poll failure records pr_sync_error and propagates the error', async () => {
    const app = await makeApp(new OutageGitHubClient());
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);

    const row = await repoRow();
    expect(row.prSyncError).toContain('503');

    // Clean up: restore healthy state for any later suites sharing the fixture.
    const healthyApp = await makeApp();
    await healthyApp.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
  });
});
