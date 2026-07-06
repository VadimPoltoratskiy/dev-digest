import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { RepoRepository } from '../src/modules/repos/repository.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/api/handler.ts b/api/handler.ts
--- a/api/handler.ts
+++ b/api/handler.ts
@@ -1,2 +1,3 @@
 import { Handler } from './types';
+import { query } from '../db/client';
 export const handler: Handler = () => {};`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'api/ imports db/ directly, violating the architecture spec.',
  score: 60,
  findings: [
    {
      id: 'f-arch',
      severity: 'CRITICAL',
      category: 'security',
      title: 'api/ module imports db/ directly',
      file: 'api/handler.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'Violates specs/architecture.md: api/ must not import db/ directly.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/**
 * Project Context, end to end: a document manually attached to an agent gets
 * read off the repo clone and actually reaches the assembled prompt + the
 * persisted run trace (specs_read, prompt_assembly.specs) — the "spec ceases
 * to be a document for people and starts to control the reviewer" acceptance
 * test from the feature request, exercised with a MockLLMProvider (no real
 * LLM calls; this module makes zero of its own regardless).
 */
d('Project Context — prompt injection end to end', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-run-'));
    await mkdir(join(clonePath, 'specs'), { recursive: true });
    await writeFile(
      join(clonePath, 'specs', 'architecture.md'),
      '# Architecture invariant\nThe api/ module must NEVER import from db/ directly.',
    );
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
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

  it('an agent-attached spec is read, injected into the prompt, and recorded in the run trace', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const workspaceId = ws!.id;

    const repos = new RepoRepository(pg.handle.db);
    const repo = await repos.insert({
      workspaceId,
      owner: 'acme',
      name: `payments-api-run-${Date.now()}`,
      fullName: `acme/payments-api-run-${Date.now()}`,
    });
    await repos.updateClonePath(repo.id, clonePath);

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 501,
        title: 'Add direct db import in api/',
        author: 'dev',
        branch: 'feat/violate-arch',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'api/handler.ts',
      additions: 1,
      deletions: 0,
      patch: "@@ -1,2 +1,3 @@\n import { Handler } from './types';\n+import { query } from '../db/client';\n export const handler: Handler = () => {};",
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Arch Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.' },
      })
    ).json();

    // Manually attach the spec — the feature under test.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/architecture.md'] },
    });
    expect(patched.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr!.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    // specs_read names the attached document.
    expect(trace.specs_read).toEqual(['specs/architecture.md']);
    // The assembled prompt actually contains the spec's invariant text.
    expect(trace.prompt_assembly.specs).toContain('api/ module must NEVER import from db/ directly');

    // No embedding/LLM call happened for the context read itself — the only
    // model call is the review's own (captured by the review outcome below).
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/reviews` })).json();
    expect(reviews[0].findings[0].rationale).toContain('specs/architecture.md');

    await app.close();
  });
});
