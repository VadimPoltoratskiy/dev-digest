import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRow, CiInstallationRow, CiRunRow, NewCiRunRow, SkillRow } from './types.js';

/**
 * CiRepository — all DB access for the ci/ module.
 * Returns typed Drizzle row objects; no business logic, no HTTP concepts.
 */
export class CiRepository {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------------------
  // Agent queries (reads from `agents` table for manifest building)
  // ---------------------------------------------------------------------------

  async findAgentById(agentId: string): Promise<AgentRow | null> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.id, agentId))
      .limit(1);
    return row ?? null;
  }

  async findAgentsByIds(ids: string[]): Promise<AgentRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(t.agents).where(inArray(t.agents.id, ids));
  }

  // ---------------------------------------------------------------------------
  // Skill queries (reads from `skills` + `agent_skills` for bundle generation)
  // ---------------------------------------------------------------------------

  /**
   * Load skills linked to an agent in their configured link order (ASC by order).
   */
  async findSkillsByAgentId(agentId: string): Promise<SkillRow[]> {
    const rows = await this.db
      .select({
        id: t.skills.id,
        workspaceId: t.skills.workspaceId,
        name: t.skills.name,
        description: t.skills.description,
        type: t.skills.type,
        source: t.skills.source,
        body: t.skills.body,
        enabled: t.skills.enabled,
        version: t.skills.version,
        evidenceFiles: t.skills.evidenceFiles,
        contextDocs: t.skills.contextDocs,
        createdAt: t.skills.createdAt,
      })
      .from(t.skills)
      .innerJoin(t.agentSkills, eq(t.skills.id, t.agentSkills.skillId))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows;
  }

  // ---------------------------------------------------------------------------
  // ci_installations queries
  // ---------------------------------------------------------------------------

  async findInstallationsByAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
  }

  /**
   * Load all ci_installations that belong to any agent in a workspace.
   * Uses a join to ci_installations.agent_id → agents.workspace_id.
   */
  async findInstallationsByWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        installedAt: t.ciInstallations.installedAt,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows;
  }

  async findInstallationById(id: string): Promise<CiInstallationRow | null> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Find or create a ci_installations row for (agentId, repo).
   * If a row already exists, updates targetType (user may re-export with a different target).
   * No unique constraint on (agent_id, repo), so uses SELECT-then-INSERT/UPDATE.
   */
  async upsertInstallation(input: {
    agentId: string;
    repo: string;
    targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  }): Promise<CiInstallationRow> {
    const [existing] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(
          eq(t.ciInstallations.agentId, input.agentId),
          eq(t.ciInstallations.repo, input.repo),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(t.ciInstallations)
        .set({ targetType: input.targetType })
        .where(eq(t.ciInstallations.id, existing.id))
        .returning();
      if (!updated) throw new Error('upsertInstallation: update returned no row');
      return updated;
    }

    const [inserted] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
      })
      .returning();
    if (!inserted) throw new Error('upsertInstallation: insert returned no row');
    return inserted;
  }

  // ---------------------------------------------------------------------------
  // ci_runs queries
  // ---------------------------------------------------------------------------

  async findRunsByInstallationIds(ids: string[]): Promise<CiRunRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, ids))
      .orderBy(desc(t.ciRuns.ranAt));
  }

  async findRunById(id: string): Promise<CiRunRow | null> {
    const [row] = await this.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Deduplication check: returns an existing ci_runs row if one already exists
   * for the given installation + github_url pair (prevents duplicate ingest on
   * repeated refresh clicks — Edge case 7).
   */
  async findRunByInstallationAndUrl(
    installationId: string,
    githubUrl: string,
  ): Promise<CiRunRow | null> {
    const [row] = await this.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installationId),
          eq(t.ciRuns.githubUrl, githubUrl),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insertRun(input: NewCiRunRow): Promise<CiRunRow> {
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: input.ciInstallationId,
        prNumber: input.prNumber,
        ranAt: input.ranAt,
        status: input.status,
        findingsCount: input.findingsCount,
        costUsd: input.costUsd,
        githubUrl: input.githubUrl,
        source: input.source,
        durationMs: input.durationMs,
      })
      .returning();
    if (!row) throw new Error('insertRun: insert returned no row');
    return row;
  }
}
