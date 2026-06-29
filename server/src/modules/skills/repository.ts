import { and, asc, desc, eq, gte, inArray, isNotNull, sql, count } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A1 — skills data-access. Owns the `skills` and `skill_versions` tables.
 * Workspace-scoped throughout.
 */

export type SkillRow = typeof t.skills.$inferSelect;

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  source: 'manual' | 'imported_url' | 'extracted' | 'community';
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  body?: string;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill and snapshot its initial body as version 1. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
      })
      .returning();
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: row!.body })
      .onConflictDoNothing();
    return row!;
  }

  /**
   * Update name/description/type/body. When body changes, bumps version and
   * snapshots the new body into skill_versions.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) {
      await this.db
        .insert(t.skillVersions)
        .values({ skillId: row.id, version: nextVersion, body: row.body })
        .onConflictDoNothing();
    }

    return row;
  }

  /** Toggle enabled without bumping version. */
  async toggle(workspaceId: string, id: string, enabled: boolean): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .update(t.skills)
      .set({ enabled })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  // ---- Version history ----

  async listVersions(workspaceId: string, skillId: string) {
    // Verify workspace membership before exposing version bodies.
    const skill = await this.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** Restore an older version body as a new version snapshot. */
  async restoreVersion(workspaceId: string, skillId: string, version: number) {
    const [snap] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    if (!snap) return undefined;
    return this.update(workspaceId, skillId, { body: snap.body });
  }

  // ---- Stats ----

  async stats(workspaceId: string, skillId: string) {
    // Agents currently linking this skill.
    const linkedAgents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));

    const agentIds = linkedAgents.map((a) => a.id);

    // Pull frequency: pct of agent_runs (for these agents) where skill was enabled.
    // We approximate: skill was enabled if it's currently linked (no historical toggle state).
    let pullFrequency = 0;
    if (agentIds.length > 0) {
      const [totalRuns] = await this.db
        .select({ n: count() })
        .from(t.agentRuns)
        .where(and(eq(t.agentRuns.workspaceId, workspaceId), inArray(t.agentRuns.agentId, agentIds)));
      const total = totalRuns?.n ?? 0;
      // Skill is linked to all these agents, so all their runs pulled it.
      pullFrequency = total > 0 ? 100 : 0;
    }

    // Findings in last 30 days from reviews by these agents.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let findings30d = 0;
    let acceptRate = 0;
    const categoryMap = new Map<string, number>();

    if (agentIds.length > 0) {
      const recentReviewIds = await this.db
        .select({ id: t.reviews.id })
        .from(t.reviews)
        .where(
          and(
            eq(t.reviews.workspaceId, workspaceId),
            inArray(t.reviews.agentId, agentIds),
            gte(t.reviews.createdAt, thirtyDaysAgo),
          ),
        );

      if (recentReviewIds.length > 0) {
        const reviewIds = recentReviewIds.map((r) => r.id);
        const recentFindings = await this.db
          .select({
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
          })
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds));

        findings30d = recentFindings.length;
        const accepted = recentFindings.filter((f) => f.acceptedAt !== null).length;
        acceptRate = findings30d > 0 ? Math.round((accepted / findings30d) * 100) : 0;

        for (const f of recentFindings) {
          categoryMap.set(f.category, (categoryMap.get(f.category) ?? 0) + 1);
        }
      }
    }

    const findingsByCategory = Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, cnt]) => ({ category, count: cnt }));

    return {
      agents_count: linkedAgents.length,
      pull_frequency: pullFrequency,
      accept_rate: acceptRate,
      findings_30d: findings30d,
      findings_by_category: findingsByCategory,
      agents: linkedAgents,
    };
  }

  // ---- Eval cases (reuse eval_cases + eval_runs tables, owner_kind='skill') ----

  async listEvalCases(workspaceId: string, skillId: string) {
    const cases = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'skill'), eq(t.evalCases.ownerId, skillId)))
      .orderBy(asc(t.evalCases.name));

    // Attach latest run to each case.
    const result = [];
    for (const c of cases) {
      const [latestRun] = await this.db
        .select({ pass: t.evalRuns.pass, actualOutput: t.evalRuns.actualOutput, ranAt: t.evalRuns.ranAt })
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, c.id))
        .orderBy(desc(t.evalRuns.ranAt))
        .limit(1);
      result.push({ ...c, latestRun: latestRun ?? null });
    }
    return result;
  }

  async getEvalCase(workspaceId: string, caseId: string) {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId), eq(t.evalCases.ownerKind, 'skill')));
    return row;
  }

  async insertEvalCase(values: {
    workspaceId: string;
    skillId: string;
    name: string;
    notes?: string;
    inputDiff: string;
    expectedFindingCount: number;
    category?: string;
    severity?: string;
  }) {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'skill',
        ownerId: values.skillId,
        name: values.name,
        notes: values.notes,
        inputDiff: values.inputDiff,
        expectedOutput: {
          expected_finding_count: values.expectedFindingCount,
          category: values.category ?? null,
          severity: values.severity ?? null,
        },
      })
      .returning();
    return row!;
  }

  async updateEvalCase(
    workspaceId: string,
    caseId: string,
    patch: { name?: string; notes?: string; inputDiff?: string; expectedFindingCount?: number; category?: string; severity?: string },
  ) {
    const existing = await this.getEvalCase(workspaceId, caseId);
    if (!existing) return undefined;

    const existingExpected = (existing.expectedOutput ?? {}) as Record<string, unknown>;
    const newExpected = {
      expected_finding_count: patch.expectedFindingCount ?? existingExpected['expected_finding_count'] ?? 1,
      category: patch.category !== undefined ? (patch.category || null) : (existingExpected['category'] ?? null),
      severity: patch.severity !== undefined ? (patch.severity || null) : (existingExpected['severity'] ?? null),
    };

    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        expectedOutput: newExpected,
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  async deleteEvalCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async insertEvalRun(values: {
    caseId: string;
    pass: boolean;
    actualFindingCount: number;
    findings: unknown[];
    durationMs?: number;
    costUsd?: number;
  }) {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        pass: values.pass,
        actualOutput: { actual_finding_count: values.actualFindingCount, findings: values.findings },
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }
}
