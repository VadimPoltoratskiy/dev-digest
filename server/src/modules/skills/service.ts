import type { Skill, SkillEvalCase, SkillEvalRunResult, SkillStats, SkillVersionEntry } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { SkillsRepository } from './repository.js';
import { toSkillDto, parseUnifiedDiff } from './helpers.js';

/** A1 — skills service. Thin delegation to repository with workspace-scope enforcement. */
export class SkillsService {
  private repo: SkillsRepository;
  private container: Container;

  constructor(container: Container) {
    this.container = container;
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(
    workspaceId: string,
    input: {
      name: string;
      description: string;
      type: 'rubric' | 'convention' | 'security' | 'custom';
      body: string;
      source?: 'manual' | 'imported_url' | 'extracted' | 'community';
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      type?: 'rubric' | 'convention' | 'security' | 'custom';
      body?: string;
    },
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async toggle(workspaceId: string, id: string, enabled: boolean): Promise<Skill | undefined> {
    const row = await this.repo.toggle(workspaceId, id, enabled);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.delete(workspaceId, id);
  }

  async listVersions(workspaceId: string, id: string): Promise<SkillVersionEntry[] | undefined> {
    const rows = await this.repo.listVersions(workspaceId, id);
    if (!rows) return undefined;
    return rows.map((r) => ({
      skill_id: r.skillId,
      version: r.version,
      body: r.body,
      created_at: r.createdAt.toISOString(),
    }));
  }

  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const row = await this.repo.restoreVersion(workspaceId, id, version);
    return row ? toSkillDto(row) : undefined;
  }

  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    return this.repo.stats(workspaceId, id);
  }

  async listEvalCases(workspaceId: string, skillId: string): Promise<SkillEvalCase[]> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return [];
    const rows = await this.repo.listEvalCases(workspaceId, skillId);
    return rows.map(toEvalCaseDto);
  }

  async createEvalCase(
    workspaceId: string,
    skillId: string,
    input: { name: string; notes?: string; inputDiff: string; expectedFindingCount?: number; category?: string; severity?: string },
  ): Promise<SkillEvalCase> {
    const row = await this.repo.insertEvalCase({
      workspaceId,
      skillId,
      name: input.name,
      notes: input.notes,
      inputDiff: input.inputDiff,
      expectedFindingCount: input.expectedFindingCount ?? 1,
      category: input.category,
      severity: input.severity,
    });
    return toEvalCaseDto({ ...row, latestRun: null });
  }

  async updateEvalCase(
    workspaceId: string,
    caseId: string,
    patch: { name?: string; notes?: string; inputDiff?: string; expectedFindingCount?: number; category?: string; severity?: string },
  ): Promise<SkillEvalCase | undefined> {
    const row = await this.repo.updateEvalCase(workspaceId, caseId, patch);
    if (!row) return undefined;
    const withRun = await this.repo.listEvalCases(workspaceId, row.ownerId);
    const updated = withRun.find((c) => c.id === caseId);
    return updated ? toEvalCaseDto(updated) : undefined;
  }

  async deleteEvalCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteEvalCase(workspaceId, caseId);
  }

  async runAllEvalCases(workspaceId: string, skillId: string): Promise<{ total: number; passed: number }> {
    const cases = await this.listEvalCases(workspaceId, skillId);
    let passed = 0;
    for (const c of cases) {
      try {
        const result = await this.runEvalCase(workspaceId, skillId, c.id);
        if (result.passed) passed++;
      } catch {
        // Continue running remaining cases even if one fails.
      }
    }
    return { total: cases.length, passed };
  }

  async runEvalCase(workspaceId: string, skillId: string, caseId: string): Promise<SkillEvalRunResult> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) throw new Error('Skill not found');

    const evalCase = await this.repo.getEvalCase(workspaceId, caseId);
    if (!evalCase) throw new Error('Eval case not found');

    const expected = (evalCase.expectedOutput ?? {}) as { expected_finding_count?: number };
    const expectedCount = expected.expected_finding_count ?? 1;

    const llm = await this.container.llm('anthropic').catch(async () => this.container.llm('openai'));
    const parsedDiff = parseUnifiedDiff(evalCase.inputDiff ?? '');

    const start = Date.now();
    const outcome = await reviewPullRequest({
      diff: parsedDiff,
      systemPrompt: 'You are a code reviewer. Apply the following skill rubric to find issues.',
      model: 'claude-haiku-4-5-20251001',
      strategy: 'single-pass',
      skills: [skill.body],
      llm,
    });
    const durationMs = Date.now() - start;

    const actualCount = outcome.review.findings.length;
    const passed = actualCount === expectedCount;

    await this.repo.insertEvalRun({
      caseId,
      pass: passed,
      actualFindingCount: actualCount,
      findings: outcome.review.findings,
      durationMs,
      costUsd: outcome.costUsd ?? undefined,
    });

    return { passed, actual_finding_count: actualCount, findings: outcome.review.findings };
  }
}

type EvalCaseRow = Awaited<ReturnType<SkillsRepository['listEvalCases']>>[number];

function toEvalCaseDto(row: EvalCaseRow): SkillEvalCase {
  const expected = (row.expectedOutput ?? {}) as {
    expected_finding_count?: number;
    category?: string | null;
    severity?: string | null;
  };
  const latestRun = row.latestRun
    ? {
        passed: row.latestRun.pass ?? false,
        actual_finding_count:
          ((row.latestRun.actualOutput as { actual_finding_count?: number } | null)?.actual_finding_count ?? 0),
        run_at: row.latestRun.ranAt.toISOString(),
      }
    : null;
  return {
    id: row.id,
    skill_id: row.ownerId,
    name: row.name,
    notes: row.notes ?? null,
    input_diff: row.inputDiff ?? '',
    expected: {
      expected_finding_count: expected.expected_finding_count ?? 1,
      category: expected.category ?? null,
      severity: expected.severity ?? null,
    },
    latest_run: latestRun,
  };
}
