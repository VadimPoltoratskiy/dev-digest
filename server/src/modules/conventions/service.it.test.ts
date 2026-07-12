import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import { ConventionsService } from './service.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('ConventionsService.convertToSkill — upsert-by-name (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai', { structured: {} }) },
      },
    });
  }

  async function insertRepo(suffix: string) {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `widget-${suffix}`,
        fullName: `acme/widget-${suffix}`,
      })
      .returning();
    return row!;
  }

  async function insertAcceptedConvention(repoId: string, rule: string) {
    await pg.handle.db.insert(t.conventions).values({
      workspaceId,
      repoId,
      rule,
      evidencePath: null,
      evidenceSnippet: null,
      confidence: 0.9,
      accepted: true,
    });
  }

  it('re-converting the same repo updates the existing skill instead of creating a duplicate', async () => {
    const app = await appWith();
    const service = new ConventionsService(app.container);
    const repo = await insertRepo('a');
    await insertAcceptedConvention(repo.id, 'Use async/await');

    const first = await service.convertToSkill(workspaceId, repo.id);
    const second = await service.convertToSkill(workspaceId, repo.id);

    expect(second.id).toBe(first.id);

    const rows = await pg.handle.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, first.name)));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('bumps version only when the extracted body actually changes', async () => {
    const app = await appWith();
    const service = new ConventionsService(app.container);
    const repo = await insertRepo('b');
    await insertAcceptedConvention(repo.id, 'Use async/await');

    const first = await service.convertToSkill(workspaceId, repo.id);
    expect(first.version).toBe(1);

    // Re-convert with identical accepted conventions — body is unchanged.
    const same = await service.convertToSkill(workspaceId, repo.id);
    expect(same.version).toBe(1);

    // Add another accepted convention — body changes.
    await insertAcceptedConvention(repo.id, 'Prefer named exports');
    const changed = await service.convertToSkill(workspaceId, repo.id);
    expect(changed.version).toBe(2);

    await app.close();
  });

  it('preserves an agent_skills link across a re-conversion', async () => {
    const app = await appWith();
    const service = new ConventionsService(app.container);
    const repo = await insertRepo('c');
    await insertAcceptedConvention(repo.id, 'Use async/await');

    const skill = await service.convertToSkill(workspaceId, repo.id);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Conventions-Link-Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
    });
    const agent = agentRes.json() as { id: string };

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });

    // Re-convert (body changes → new version), the link should still point at the same skill id.
    await insertAcceptedConvention(repo.id, 'Prefer named exports');
    await service.convertToSkill(workspaceId, repo.id);

    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agent.id), eq(t.agentSkills.skillId, skill.id)));
    expect(links).toHaveLength(1);

    await app.close();
  });
});
