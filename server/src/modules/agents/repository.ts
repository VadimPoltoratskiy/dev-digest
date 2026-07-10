import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  }

  // ---- Project Context (agent-level attach) ------------------------------

  /**
   * Replace the agent's attached Project Context document paths, in order
   * (order = injection order into "## Project context"). Full-array replace,
   * same pattern as `setSkills`.
   */
  async setContextDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .update(t.agents)
      .set({ contextDocs: paths })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .returning();
    return row;
  }

  // ---- Agent eval cases + eval runs (owner_kind='agent') ------------------

  /**
   * All eval cases for an agent (workspace + owner-scoped), ordered by name.
   * Each case gets the latest eval_run row attached as `latestRun`.
   */
  async listAgentEvalCases(
    workspaceId: string,
    agentId: string,
  ): Promise<(typeof t.evalCases.$inferSelect & { latestRun: typeof t.evalRuns.$inferSelect | null })[]> {
    const cases = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.name));

    const result: (typeof t.evalCases.$inferSelect & {
      latestRun: typeof t.evalRuns.$inferSelect | null;
    })[] = [];
    for (const c of cases) {
      const [latestRun] = await this.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, c.id))
        .orderBy(desc(t.evalRuns.ranAt))
        .limit(1);
      result.push({ ...c, latestRun: latestRun ?? null });
    }
    return result;
  }

  /** A single eval case scoped to workspace + ownerKind='agent'. */
  async getAgentEvalCase(
    workspaceId: string,
    caseId: string,
  ): Promise<typeof t.evalCases.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, caseId),
          eq(t.evalCases.ownerKind, 'agent'),
        ),
      );
    return row;
  }

  /**
   * Delete an agent eval case. Returns false when no row was deleted.
   */
  async deleteAgentEvalCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.id, caseId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /**
   * Insert one eval_run row for an agent eval case.
   * `recall/precision/citationAccuracy` start as null and are patched later
   * by `updateBatchMetrics` once all cases in the batch have completed.
   */
  async insertEvalRun(values: {
    caseId: string;
    pass: boolean;
    ranAt: Date;
    actualOutput: unknown;
    durationMs?: number;
    costUsd?: number | null;
  }): Promise<typeof t.evalRuns.$inferSelect> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        ranAt: values.ranAt,
        pass: values.pass,
        actualOutput: values.actualOutput as object,
        durationMs: values.durationMs,
        costUsd: values.costUsd ?? null,
        // recall/precision/citationAccuracy are set by updateBatchMetrics
        recall: null,
        precision: null,
        citationAccuracy: null,
      })
      .returning();
    return row!;
  }

  /**
   * Denormalize batch-level metrics back onto all eval_run rows that share
   * the same `ranAt` within the given case set.
   */
  async updateBatchMetrics(
    caseIds: string[],
    ranAt: Date,
    metrics: {
      recall: number | null;
      precision: number | null;
      citationAccuracy: number | null;
    },
  ): Promise<void> {
    if (caseIds.length === 0) return;
    await this.db
      .update(t.evalRuns)
      .set({
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citationAccuracy,
      })
      .where(
        and(inArray(t.evalRuns.caseId, caseIds), eq(t.evalRuns.ranAt, ranAt)),
      );
  }

  /**
   * All eval_run rows for the given case IDs, newest first.
   * Returns [] when `caseIds` is empty to avoid Drizzle's `inArray([])` error.
   */
  async listEvalRunsByCaseIds(
    caseIds: string[],
  ): Promise<(typeof t.evalRuns.$inferSelect)[]> {
    if (caseIds.length === 0) return [];
    return this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /**
   * Eval_run rows for a specific batch (identified by `ranAt`) within the
   * given case set; includes the case name from the joined eval_cases row.
   */
  async listEvalRunsByRanAt(
    caseIds: string[],
    ranAt: Date,
  ): Promise<(typeof t.evalRuns.$inferSelect & { caseName: string })[]> {
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: t.evalRuns.id,
        caseId: t.evalRuns.caseId,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        caseName: t.evalCases.name,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(inArray(t.evalRuns.caseId, caseIds), eq(t.evalRuns.ranAt, ranAt)),
      );
    return rows;
  }
}
