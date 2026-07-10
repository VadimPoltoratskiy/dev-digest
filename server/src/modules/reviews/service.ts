import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import type { AgentEvalCase } from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import type { IntentRecord } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { IntentClassifier } from './intent-classifier.js';
import { getPrFilePatch, insertFindingEvalCase } from './repository/eval-case.repo.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;
  private classifier: IntentClassifier;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
    this.classifier = new IntentClassifier(container);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Classify intent synchronously (fast flash model) before agents start, so
    // intent is available in the prompt for every agent run launched below.
    // Best-effort: a classifier failure must NOT block the review.
    try {
      await this.classifyIntent(workspaceId, prId, { force: false, logger });
    } catch (err) {
      logger?.warn({ prId, err: (err as Error).message }, 'review: intent classification failed — continuing without intent');
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  /**
   * Create an agent eval case from an accepted or dismissed finding.
   * The finding's file patch becomes the `input_diff`; the accepted/dismissed
   * state determines `kind` ('must_find' | 'must_not_flag').
   */
  async createFindingEvalCase(
    workspaceId: string,
    findingId: string,
  ): Promise<AgentEvalCase> {
    // 1. Resolve finding → review → pull
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { finding, review, pull } = ctx;

    // 2. Workspace scope guard
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');

    // 3. State guards
    if (finding.acceptedAt !== null && finding.dismissedAt !== null) {
      throw new ValidationError(
        'Finding has both accepted_at and dismissed_at set — state is ambiguous (AC-3b)',
      );
    }
    if (finding.acceptedAt === null && finding.dismissedAt === null) {
      throw new ValidationError(
        'Finding must be accepted or dismissed before creating an eval case',
      );
    }

    // 4. Agent guard
    if (review.agentId === null) {
      throw new ValidationError(
        "The finding's parent review has no linked agent (AC-3)",
      );
    }

    // 5. Get the file patch from pr_files
    const patch = await getPrFilePatch(this.container.db, pull.id, finding.file);
    if (patch === undefined || patch === null) {
      throw new ValidationError(
        'No diff patch is available for this file — cannot create a case with empty input_diff (AC-3a)',
      );
    }

    // 6. Determine kind and build expected output
    const kind: 'must_find' | 'must_not_flag' =
      finding.acceptedAt !== null ? 'must_find' : 'must_not_flag';

    const name = finding.title.slice(0, 80);

    const expectedOutput = {
      kind,
      finding: {
        file: finding.file,
        start_line: finding.startLine,
        end_line: finding.endLine,
        title: finding.title,
        severity: finding.severity,
        category: finding.category,
      },
    };

    // 7. Insert the eval case
    const row = await insertFindingEvalCase(this.container.db, {
      workspaceId,
      agentId: review.agentId,
      name,
      inputDiff: patch,
      expectedOutput,
    });

    return {
      id: row.id,
      agent_id: row.ownerId,
      name: row.name,
      notes: row.notes ?? null,
      input_diff: row.inputDiff ?? '',
      expected_output: row.expectedOutput as AgentEvalCase['expected_output'],
      latest_run: null,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Intent
  // ===========================================================================

  async getIntent(workspaceId: string, prId: string): Promise<IntentRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return (await this.repo.getIntent(prId)) ?? null;
  }

  /**
   * Classify (or re-classify) intent for a PR and persist the result.
   * Called automatically at review start if no intent exists; also exposed as
   * POST /pulls/:id/intent for the manual "Recalculate" button.
   */
  async classifyIntent(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean; logger?: Logger } = {},
  ): Promise<IntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const params = await this.classifier.classify(workspaceId, pull, opts);
    await this.repo.upsertIntent(prId, params);
    return (await this.repo.getIntent(prId))!;
  }
}
