import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { RepoRepository } from '../src/modules/repos/repository.js';
import { workspaces } from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Project Context — recursive markdown discovery under specs/docs/insights,
 * manual attach to agents/skills (used_by_count), and the reindex endpoint.
 * No LLM calls anywhere in this module: everything here reads the clone dir
 * directly off disk.
 */
d('Project Context', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-'));
    await mkdir(join(clonePath, 'specs', 'nested'), { recursive: true });
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await mkdir(join(clonePath, 'insights'), { recursive: true });
    await writeFile(join(clonePath, 'specs', 'architecture.md'), '# Architecture\napi/ must not import db/ directly.');
    await writeFile(join(clonePath, 'specs', 'nested', 'rule.md'), '# Nested rule');
    await writeFile(join(clonePath, 'docs', 'guide.md'), '# Guide');
    await writeFile(join(clonePath, 'insights', 'notes.md'), '# Notes');
    // Should NOT be picked up — not under specs/docs/insights.
    await writeFile(join(clonePath, 'README.md'), '# Not context');
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  /** A repo row pointed at the shared fixture clonePath (no live git clone). */
  async function makeClonedRepo(): Promise<string> {
    const repos = new RepoRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select({ id: workspaces.id }).from(workspaces).limit(1);
    const row = await repos.insert({
      workspaceId: ws!.id,
      owner: 'acme',
      name: `payments-api-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fullName: `acme/payments-api-${Date.now()}`,
    });
    await repos.updateClonePath(row.id, clonePath);
    return row.id;
  }

  it('GET /repos/:id/context recursively finds markdown under specs/docs/insights only', async () => {
    const app = await makeApp();
    const repoId = await makeClonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const files = res.json() as Array<{ path: string; root: string; content: string; used_by_count: number }>;

    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['docs/guide.md', 'insights/notes.md', 'specs/architecture.md', 'specs/nested/rule.md']);
    expect(files.every((f) => f.used_by_count === 0)).toBe(true);

    const arch = files.find((f) => f.path === 'specs/architecture.md')!;
    expect(arch.root).toBe('specs');
    expect(arch.content).toContain('api/ must not import db/ directly');
    await app.close();
  });

  it('attaching a document to an agent raises its used_by_count', async () => {
    const app = await makeApp();
    const repoId = await makeClonedRepo();

    const agent = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Ctx Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
    });
    const agentId = agent.json().id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['specs/architecture.md'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().context_docs).toEqual(['specs/architecture.md']);

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const files = res.json() as Array<{ path: string; used_by_count: number }>;
    expect(files.find((f) => f.path === 'specs/architecture.md')!.used_by_count).toBe(1);
    expect(files.find((f) => f.path === 'docs/guide.md')!.used_by_count).toBe(0);
    await app.close();
  });

  it('POST /repos/:id/context/reindex re-scans and returns a done status', async () => {
    const app = await makeApp();
    const repoId = await makeClonedRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'done', pct: 100, chunks_indexed: 4 });
    await app.close();
  });

  it('404s for an unknown repo', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({ method: 'GET', url: `/repos/${ghost}/context` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('422s when the repo has not been cloned yet', async () => {
    const app = await makeApp();
    const repos = new RepoRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select({ id: workspaces.id }).from(workspaces).limit(1);
    const row = await repos.insert({
      workspaceId: ws!.id,
      owner: 'acme',
      name: `not-cloned-${Date.now()}`,
      fullName: `acme/not-cloned-${Date.now()}`,
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${row.id}/context` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
