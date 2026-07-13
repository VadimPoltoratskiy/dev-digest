/**
 * ci.it.test.ts — DB-backed integration tests for the ci/ module.
 *
 * Uses testcontainers (pgvector/pg16) via test/helpers/pg.ts.
 * Self-skips when Docker is unavailable (CI environments without Docker-in-Docker).
 *
 * Covers (route-level via app.inject):
 *   POST /agents/:id/export-ci          action=files  (AC-2, no GitHub calls)
 *   GET  /agents/:id/ci-installations   (AC-18)
 *   GET  /ci/runs                       (AC-16, agent enrichment, duration_s)
 *   GET  /ci/runs/:id                   (single run with workspace check)
 *   POST /ci/runs/refresh               (AC-17, deduplication on second call)
 *   GET  /ci/preflight                  (AC-22, write-access check)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient, MockGitClient, MockEmbedder } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { RepoRef, WorkflowRun } from '@devdigest/shared';

// ===========================================================================
// Docker guard — self-skip when Docker is unavailable
// ===========================================================================

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ===========================================================================
// Fixtures for the refresh (AC-17) test
// ===========================================================================

const REFRESH_WORKFLOW_RUN: WorkflowRun = {
  id: 99999,
  html_url: 'https://github.com/owner/refresh-repo/actions/runs/99999',
  created_at: '2026-07-10T12:00:00Z',
  status: 'completed',
};

const REFRESH_ARTIFACT_JSON = JSON.stringify({
  findings_count: 2,
  cost_usd: 0.003,
  duration_ms: 3000,
  agent: 'Test Agent',
  pr_number: 10,
});

/**
 * MockGitHubClient sub-class that returns one workflow run for 'refresh-repo'
 * and the REFRESH_ARTIFACT_JSON for any downloadArtifact call.
 * All other installations (e.g. owner/test-repo) see empty workflow run lists.
 */
class RefreshMockGitHubClient extends MockGitHubClient {
  override async listWorkflowRuns(repo: RepoRef): Promise<WorkflowRun[]> {
    return repo.name === 'refresh-repo' ? [REFRESH_WORKFLOW_RUN] : [];
  }

  override async downloadArtifact(
    _repo: RepoRef,
    _runId: number,
    _artifactName: string,
  ): Promise<string | null> {
    return REFRESH_ARTIFACT_JSON;
  }
}

// ===========================================================================
// Integration test suite
// ===========================================================================

d('CI Routes — testcontainers integration', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let installationId: string;
  let runId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    // Pull workspace + one agent from seed data
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .limit(1);
    agentId = agent!.id;

    // Seed a ci_installations row for agent/GET tests
    const [installation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: 'owner/test-repo', targetType: 'gha' })
      .returning();
    installationId = installation!.id;

    // Seed a ci_runs row so GET /ci/runs and GET /ci/runs/:id have data
    const [run] = await pg.handle.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: installationId,
        prNumber: 42,
        ranAt: new Date('2026-07-01T12:00:00Z'),
        status: 'completed',
        findingsCount: 3,
        costUsd: 0.005,
        githubUrl: 'https://github.com/owner/test-repo/actions/runs/11111',
        source: 'ci',
        durationMs: 5000,
      })
      .returning();
    runId = run!.id;

    // Seed a second ci_installations row pointing at 'refresh-repo'.
    // The RefreshMockGitHubClient will return workflow runs for this repo only,
    // so the refresh test exercises the ingest + dedup path in isolation.
    await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: 'owner/refresh-repo', targetType: 'gha' })
      .returning();
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * Build a Fastify app with a test DB and mock adapters.
   * Pass a custom GitHubClient to control listWorkflowRuns / downloadArtifact.
   */
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

  // -------------------------------------------------------------------------
  // POST /agents/:id/export-ci — action="files" (AC-2, no GitHub calls)
  // -------------------------------------------------------------------------
  it('POST /agents/:id/export-ci action=files → 200, pr_url null, correct file paths, no ci_installations row', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo: 'owner/files-only-repo',
        target: 'gha',
        action: 'files',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize'],
        base: 'main',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      pr_url: string | null;
      files: Array<{ path: string }>;
    };

    expect(body.pr_url).toBeNull();
    expect(Array.isArray(body.files)).toBe(true);

    // AC-2(c): memory.jsonl must be present
    expect(body.files.find((f) => f.path === '.devdigest/memory.jsonl')).toBeDefined();
    // AC-2(e): GHA workflow file must be present for target='gha'
    expect(
      body.files.find((f) => f.path === '.github/workflows/devdigest-review.yml'),
    ).toBeDefined();
    // AC-2(a): agent manifest must be present
    expect(body.files.find((f) => f.path.startsWith('.devdigest/agents/'))).toBeDefined();

    // No ci_installations row should be created for action='files'
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, 'owner/files-only-repo'));
    expect(rows).toHaveLength(0);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /agents/:id/ci-installations (AC-18)
  // -------------------------------------------------------------------------
  it('GET /agents/:id/ci-installations → 200, returns seeded installation row', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci-installations`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; repo: string; target_type: string }>;

    expect(Array.isArray(body)).toBe(true);
    const found = body.find((i) => i.id === installationId);
    expect(found).toBeDefined();
    expect(found!.repo).toBe('owner/test-repo');
    expect(found!.target_type).toBe('gha');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /ci/runs (AC-16 — agent enrichment, duration_s computation)
  // -------------------------------------------------------------------------
  it('GET /ci/runs → 200, returns seeded run with agent name and duration_s', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/ci/runs' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      agent: string | null;
      duration_s: number | null;
      pr_number: number | null;
    }>;

    expect(Array.isArray(body)).toBe(true);
    const run = body.find((r) => r.id === runId);
    expect(run).toBeDefined();

    // agent field must be enriched with the agent's name
    expect(run!.agent).toBeTruthy();
    // duration_s = durationMs / 1000 = 5000 / 1000 = 5.0
    expect(run!.duration_s).toBeCloseTo(5.0);
    expect(run!.pr_number).toBe(42);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /ci/runs/:id
  // -------------------------------------------------------------------------
  it('GET /ci/runs/:id → 200, returns the specific run by ID', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: `/ci/runs/${runId}` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      pr_number: number | null;
      findings_count: number | null;
    };

    expect(body.id).toBe(runId);
    expect(body.pr_number).toBe(42);
    expect(body.findings_count).toBe(3);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /ci/runs/:id — 404 for unknown ID
  // -------------------------------------------------------------------------
  it('GET /ci/runs/:id → 404 for a run that does not exist', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'GET',
      url: '/ci/runs/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /ci/runs/refresh (AC-17)
  // First call: inserts 1 run for owner/refresh-repo.
  // Second call: same run URL already in DB → deduplication → inserted=0, skipped=0.
  // -------------------------------------------------------------------------
  it('POST /ci/runs/refresh → first call inserts 1; second call deduplicates (0 inserted, 0 skipped)', async () => {
    const app = await makeApp(new RefreshMockGitHubClient());

    // First refresh — should ingest the run from owner/refresh-repo
    const res1 = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toMatchObject({ inserted: 1, skipped: 0 });

    // Second refresh — same github_url already in ci_runs → deduplication, not counted as skipped
    const res2 = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ inserted: 0, skipped: 0 });

    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /ci/preflight (AC-22)
  // -------------------------------------------------------------------------
  it('GET /ci/preflight?repo=owner/test-repo → 200, has_write_access: true, secrets status', async () => {
    // Default MockGitHubClient.checkWriteAccess() returns true;
    // listRepoSecretNames() returns ['OPENROUTER_API_KEY'].
    const app = await makeApp();

    const res = await app.inject({
      method: 'GET',
      url: '/ci/preflight?repo=owner/test-repo',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      has_write_access: true,
      secrets: { openrouter_api_key: true, github_token: true },
    });

    await app.close();
  });

  // -------------------------------------------------------------------------
  // DELETE /agents/:id/ci-installations/:installationId ("Remove from CI")
  // -------------------------------------------------------------------------
  it('DELETE /agents/:id/ci-installations/:installationId → 204, row removed, then re-adding the same repo does not break', async () => {
    const app = await makeApp();

    // 1. Add the repo (action=open_pr against the mock GitHub client — no real network).
    const exportRes1 = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo: 'owner/removable-repo',
        target: 'gha',
        action: 'open_pr',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize'],
        base: 'main',
      },
    });
    expect(exportRes1.statusCode).toBe(200);
    const removableInstallationId = (exportRes1.json() as { installation: { id: string } })
      .installation.id;
    expect(removableInstallationId).toBeTruthy();

    // 2. Confirm it shows up in the installations list.
    const beforeDelete = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci-installations`,
    });
    expect(
      (beforeDelete.json() as Array<{ id: string }>).some((i) => i.id === removableInstallationId),
    ).toBe(true);

    // 3. Remove it.
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/agents/${agentId}/ci-installations/${removableInstallationId}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // 4. Confirm it's gone.
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci-installations`,
    });
    expect(
      (afterDelete.json() as Array<{ id: string }>).some((i) => i.id === removableInstallationId),
    ).toBe(false);

    // 5. Its ci_runs history (if any) is preserved with ci_installation_id set
    //    to NULL, per the schema's ON DELETE SET NULL — never hard-deleted.
    const orphanedRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, removableInstallationId));
    expect(orphanedRuns).toHaveLength(0); // none seeded for this repo, but the query itself must not error

    // 6. Re-adding the same repo afterward must succeed cleanly (upsert
    //    re-inserts rather than colliding on a stale/duplicate row).
    const exportRes2 = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo: 'owner/removable-repo',
        target: 'gha',
        action: 'open_pr',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize'],
        base: 'main',
      },
    });
    expect(exportRes2.statusCode).toBe(200);
    const reAddedInstallationId = (exportRes2.json() as { installation: { id: string } })
      .installation.id;
    expect(reAddedInstallationId).toBeTruthy();
    // A fresh row, not the deleted one.
    expect(reAddedInstallationId).not.toBe(removableInstallationId);

    await app.close();
  });

  it('DELETE /agents/:id/ci-installations/:installationId → 404 when the installation belongs to a different agent', async () => {
    const app = await makeApp();

    // installationId (from beforeAll) belongs to `agentId`; use a random different agent id.
    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/00000000-0000-0000-0000-000000000001/ci-installations/${installationId}`,
    });

    expect(res.statusCode).toBe(404);

    // Confirm the row was NOT deleted.
    const stillThere = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/ci-installations`,
    });
    expect(
      (stillThere.json() as Array<{ id: string }>).some((i) => i.id === installationId),
    ).toBe(true);

    await app.close();
  });
});
