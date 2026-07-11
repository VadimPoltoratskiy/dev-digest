import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentEvalBatchResult,
  AgentEvalCase,
  AgentEvalCompare,
  AgentEvalExpectedOutput,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  EvalRunRecord,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentEvalExpectedOutput as AgentEvalExpectedOutputSchema } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { parseUnifiedDiff } from '../_shared/diff-helpers.js';
import { scoreMustFind, scoreMustNotFlag, computeBatchMetrics } from './eval-scorer.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /** Unlink a single skill from an agent. Returns undefined when agent not found. */
  async unlinkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.unlinkSkill(agentId, skillId);
    return this.skillLinks(agentId);
  }

  /** Replace the agent's attached Project Context document paths, in order. */
  async setContextDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<Agent | undefined> {
    const row = await this.repo.setContextDocs(workspaceId, agentId, paths);
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Agent eval cases
  // ===========================================================================

  /** All eval cases for an agent as `AgentEvalCase[]` DTOs. */
  async listAgentEvalCases(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentEvalCase[]> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const rows = await this.repo.listAgentEvalCases(workspaceId, agentId);
    return rows.map((r) => ({
      id: r.id,
      agent_id: r.ownerId,
      name: r.name,
      notes: r.notes ?? null,
      input_diff: r.inputDiff ?? '',
      expected_output: r.expectedOutput as AgentEvalCase['expected_output'],
      latest_run: r.latestRun
        ? { pass: r.latestRun.pass ?? null, ran_at: r.latestRun.ranAt.toISOString() }
        : null,
    }));
  }

  /** Delete an agent eval case. Throws 404 when the case is not found. */
  async deleteAgentEvalCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<void> {
    const ok = await this.repo.deleteAgentEvalCase(workspaceId, agentId, caseId);
    if (!ok) throw new NotFoundError('Eval case not found');
  }

  // ===========================================================================
  // Agent eval batch run
  // ===========================================================================

  /**
   * Run all eval cases for an agent and return the batch result.
   *
   * Security: `input_diff` always flows through `reviewPullRequest` (the
   * citation-grounding gate) — never directly to an LLM adapter.
   */
  async runAgentEvalBatch(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentEvalBatchResult> {
    // 1. Load agent (404 guard)
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // 2. Snapshot skill bodies once before the loop (AC-11 edge case 5)
    const links = await this.repo.linkedSkills(agentId);
    const skillBodies = links.map((l) => l.skill.body);

    // 3. Single timestamp for the entire batch (AC-11)
    const ranAt = new Date();
    const batchStart = Date.now();

    // 4. Load all cases
    const caseRows = await this.repo.listAgentEvalCases(workspaceId, agentId);

    // 5. Zero-case short-circuit (AC-13)
    if (caseRows.length === 0) {
      return {
        ran_at: ranAt.toISOString(),
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        duration_ms: 0,
        cost_usd: null,
        per_trace: [],
      };
    }

    // 6. Resolve LLM adapter once (before loop)
    const llm = await this.container.llm(agent.provider as 'openai' | 'anthropic' | 'openrouter');

    // 7. Per-case loop
    const perTrace: AgentEvalBatchResult['per_trace'] = [];
    const metricsInputs: Array<{
      kind: 'must_find' | 'must_not_flag';
      pass: boolean;
      candidatesKept: number;
      candidatesDropped: number;
    }> = [];
    const insertedCaseIds: string[] = [];
    let totalCostUsd: number | null = 0;

    for (const caseRow of caseRows) {
      // Parse and validate the expected output
      const parseResult = AgentEvalExpectedOutputSchema.safeParse(caseRow.expectedOutput);
      if (!parseResult.success) {
        // Invalid stored expected_output → mark as failed, skip
        await this.repo.insertEvalRun({
          caseId: caseRow.id,
          pass: false,
          ranAt,
          actualOutput: { error: `Invalid expected_output: ${parseResult.error.message}` },
        });
        insertedCaseIds.push(caseRow.id);
        // Kind is unknown/unreliable when expected_output fails validation — record the
        // failure for visibility but exclude it from metricsInputs so it can't skew
        // recall/precision under a guessed kind (AC-5/AC-6 define those over known kinds).
        perTrace.push({
          case_id: caseRow.id,
          case_name: caseRow.name,
          kind: 'must_find',
          pass: false,
          expected_output: caseRow.expectedOutput as AgentEvalExpectedOutput,
          actual_findings: [],
          error: `Invalid expected_output: ${parseResult.error.message}`,
        });
        continue;
      }

      const expected = parseResult.data;
      const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');
      const caseStart = Date.now();

      try {
        // Security: input_diff flows through reviewPullRequest only (AC gate)
        const outcome = await reviewPullRequest({
          diff,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          strategy: (agent.strategy ?? 'auto') as ReviewStrategy,
          skills: skillBodies,
          llm,
        });

        const durationMs = Date.now() - caseStart;
        const actualFindings = outcome.review.findings;
        const pass =
          expected.kind === 'must_find'
            ? scoreMustFind(expected.finding, actualFindings)
            : scoreMustNotFlag(expected.finding, actualFindings);

        const costUsd = outcome.costUsd;
        if (totalCostUsd !== null) {
          totalCostUsd = costUsd === null ? null : totalCostUsd + costUsd;
        }

        await this.repo.insertEvalRun({
          caseId: caseRow.id,
          pass,
          ranAt,
          actualOutput: { findings: actualFindings },
          durationMs,
          costUsd: costUsd ?? null,
        });
        insertedCaseIds.push(caseRow.id);

        perTrace.push({
          case_id: caseRow.id,
          case_name: caseRow.name,
          kind: expected.kind,
          pass,
          expected_output: expected,
          actual_findings: actualFindings,
        });
        metricsInputs.push({
          kind: expected.kind,
          pass,
          candidatesKept: actualFindings.length,
          candidatesDropped: outcome.dropped.length,
        });
      } catch (err) {
        // AC-12: per-case errors don't abort the batch
        const errorMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - caseStart;
        await this.repo.insertEvalRun({
          caseId: caseRow.id,
          pass: false,
          ranAt,
          actualOutput: { error: errorMsg },
          durationMs,
        });
        insertedCaseIds.push(caseRow.id);

        perTrace.push({
          case_id: caseRow.id,
          case_name: caseRow.name,
          kind: expected.kind,
          pass: false,
          expected_output: expected,
          actual_findings: [],
          error: errorMsg,
        });
        metricsInputs.push({
          kind: expected.kind,
          pass: false,
          candidatesKept: 0,
          candidatesDropped: 0,
        });
      }
    }

    // 8. Compute batch metrics
    const metrics = computeBatchMetrics(metricsInputs);

    // 9. Denormalize metrics onto all inserted rows
    await this.repo.updateBatchMetrics(insertedCaseIds, ranAt, {
      recall: metrics.recall,
      precision: metrics.precision,
      citationAccuracy: metrics.citation_accuracy,
    });

    const tracesPassed = perTrace.filter((t) => t.pass).length;
    const durationMs = Date.now() - batchStart;

    return {
      ran_at: ranAt.toISOString(),
      recall: metrics.recall,
      precision: metrics.precision,
      citation_accuracy: metrics.citation_accuracy,
      traces_passed: tracesPassed,
      traces_total: perTrace.length,
      duration_ms: durationMs,
      cost_usd: totalCostUsd,
      per_trace: perTrace,
    };
  }

  // ===========================================================================
  // Agent eval run history + compare
  // ===========================================================================

  /** All eval run records for an agent (grouped by `ran_at` on the client). */
  async listAgentEvalRuns(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalRunRecord[]> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const caseRows = await this.repo.listAgentEvalCases(workspaceId, agentId);
    const caseIds = caseRows.map((c) => c.id);
    const caseNameMap = new Map(caseRows.map((c) => [c.id, c.name]));

    const runRows = await this.repo.listEvalRunsByCaseIds(caseIds);
    return runRows.map((r) => ({
      id: r.id,
      case_id: r.caseId,
      case_name: caseNameMap.get(r.caseId) ?? null,
      ran_at: r.ranAt.toISOString(),
      actual_output: r.actualOutput,
      pass: r.pass ?? null,
      recall: r.recall ?? null,
      precision: r.precision ?? null,
      citation_accuracy: r.citationAccuracy ?? null,
      duration_ms: r.durationMs ?? null,
      cost_usd: r.costUsd ?? null,
    }));
  }

  /**
   * Compare two eval batch runs by their `ran_at` timestamps.
   * Both timestamps must be valid ISO strings referring to existing batches.
   */
  async compareAgentEvalRuns(
    workspaceId: string,
    agentId: string,
    ranAtA: string,
    ranAtB: string,
  ): Promise<AgentEvalCompare> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    if (ranAtA === ranAtB) {
      throw new ValidationError('run_a and run_b must be different timestamps');
    }

    const dateA = new Date(ranAtA);
    const dateB = new Date(ranAtB);
    if (isNaN(dateA.getTime())) throw new ValidationError(`Invalid timestamp for run_a: ${ranAtA}`);
    if (isNaN(dateB.getTime())) throw new ValidationError(`Invalid timestamp for run_b: ${ranAtB}`);

    const caseRows = await this.repo.listAgentEvalCases(workspaceId, agentId);
    const caseIds = caseRows.map((c) => c.id);

    const [batchA, batchB] = await Promise.all([
      this.repo.listEvalRunsByRanAt(caseIds, dateA),
      this.repo.listEvalRunsByRanAt(caseIds, dateB),
    ]);

    if (batchA.length === 0) throw new NotFoundError(`No eval runs found for ran_at=${ranAtA}`);
    if (batchB.length === 0) throw new NotFoundError(`No eval runs found for ran_at=${ranAtB}`);

    // Batch-level metrics are denormalized onto every row — read from first row
    const firstA = batchA[0]!;
    const firstB = batchB[0]!;

    const runA = {
      ran_at: firstA.ranAt.toISOString(),
      recall: firstA.recall ?? null,
      precision: firstA.precision ?? null,
      citation_accuracy: firstA.citationAccuracy ?? null,
      cost_usd: batchA.reduce<number | null>((sum, r) => {
        if (sum === null || r.costUsd === null) return null;
        return sum + r.costUsd;
      }, 0),
    };
    const runB = {
      ran_at: firstB.ranAt.toISOString(),
      recall: firstB.recall ?? null,
      precision: firstB.precision ?? null,
      citation_accuracy: firstB.citationAccuracy ?? null,
      cost_usd: batchB.reduce<number | null>((sum, r) => {
        if (sum === null || r.costUsd === null) return null;
        return sum + r.costUsd;
      }, 0),
    };

    const delta = (a: number | null, b: number | null): number | null =>
      a === null || b === null ? null : b - a;

    // Build a map of caseId → pass for each batch
    const passMapA = new Map(batchA.map((r) => [r.caseId, r.pass ?? false]));
    const passMapB = new Map(batchB.map((r) => [r.caseId, r.pass ?? false]));

    const allCaseIds = new Set([...passMapA.keys(), ...passMapB.keys()]);
    const caseNameMap = new Map(batchA.map((r) => [r.caseId, r.caseName]));
    for (const r of batchB) {
      if (!caseNameMap.has(r.caseId)) caseNameMap.set(r.caseId, r.caseName);
    }

    const flips: AgentEvalCompare['flips'] = [];
    for (const caseId of allCaseIds) {
      const fromPass = passMapA.get(caseId) ?? false;
      const toPass = passMapB.get(caseId) ?? false;
      if (fromPass !== toPass) {
        flips.push({
          case_id: caseId,
          case_name: caseNameMap.get(caseId) ?? caseId,
          from_pass: fromPass,
          to_pass: toPass,
        });
      }
    }

    return {
      run_a: runA,
      run_b: runB,
      deltas: {
        recall: delta(runA.recall, runB.recall),
        precision: delta(runA.precision, runB.precision),
        citation_accuracy: delta(runA.citation_accuracy, runB.citation_accuracy),
        cost_usd: delta(runA.cost_usd, runB.cost_usd),
      },
      flips,
    };
  }
}
