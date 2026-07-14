import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import type { AgentEvalCase, GitHubClient, PrReviewComment } from '@devdigest/shared';
import type { ComposeReviewBody, ComposeReviewResponse } from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow, FindingRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import type { IntentRecord } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding, buildCommentBody } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { IntentClassifier } from './intent-classifier.js';
import { getPrFilePatch, insertFindingEvalCase } from './repository/eval-case.repo.js';
import { loadDiff } from './diff-loader.js';

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
   *
   * @param opts.multiRunId — when provided, the FK `multi_agent_run_id` is set
   *   on every `agent_runs` row so the multi-run service can group them.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
    opts?: { multiRunId?: string },
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
        multiAgentRunId: opts?.multiRunId ?? null,
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
   * Create an agent eval case from a finding (any accept/dismiss state).
   * The finding's file patch becomes the `input_diff`; `kind` is caller-supplied
   * since it can no longer be inferred from accepted/dismissed state alone.
   */
  async createFindingEvalCase(
    workspaceId: string,
    findingId: string,
    kind: 'must_find' | 'must_not_flag',
    name?: string,
  ): Promise<AgentEvalCase> {
    // 1. Resolve finding → review → pull
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { finding, review, pull } = ctx;

    // 2. Workspace scope guard
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');

    // 3. Agent guard
    if (review.agentId === null) {
      throw new ValidationError(
        "The finding's parent review has no linked agent (AC-3)",
      );
    }

    // 4. Get the file patch from pr_files
    const patch = await getPrFilePatch(this.container.db, pull.id, finding.file);
    if (patch === undefined || patch === null) {
      throw new ValidationError(
        'No diff patch is available for this file — cannot create a case with empty input_diff (AC-3a)',
      );
    }

    // 5. Build expected output from the caller-supplied kind
    const caseName = (name ?? finding.title).slice(0, 80);

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

    // 6. Insert the eval case
    const row = await insertFindingEvalCase(this.container.db, {
      workspaceId,
      agentId: review.agentId,
      name: caseName,
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

  /**
   * Post a real GitHub PR review comment anchored to the finding's file/line,
   * as if replying to the PR author about it. Findings don't have an existing
   * GitHub comment thread of their own, so this always creates a fresh
   * top-level review comment (no `in_reply_to`) — GitHub is the source of
   * truth, nothing is persisted on the finding row.
   */
  async replyToFinding(
    workspaceId: string,
    findingId: string,
    replyText: string,
  ): Promise<{ comment: PrReviewComment }> {
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { finding, pull } = ctx;
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');

    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError(
        'github_unavailable',
        'Connect a GitHub token to reply to the author.',
        400,
      );
    }

    try {
      const comment = await gh.createReviewComment(
        { owner: repoRow.owner, name: repoRow.name },
        pull.number,
        {
          commitId: pull.headSha,
          path: finding.file,
          line: finding.endLine,
          side: 'RIGHT',
          body: replyText,
        },
      );
      return { comment };
    } catch (err) {
      throw new AppError('github_comment_failed', 'Failed to post the reply to GitHub.', 400, {
        cause: String(err),
      });
    }
  }

  /**
   * Post a human-curated GitHub PR review (verdict + optional inline comments
   * derived from selected AI findings). Each selected finding becomes one inline
   * comment anchored to its file path and end line. Findings whose end_line falls
   * outside the current PR diff are silently omitted (GitHub would reject them
   * with a 422); the count of omitted findings is returned in `omitted_count`.
   *
   * Security: `finding_ids` are verified to belong to the request's workspace +
   * PR before their content is passed to GitHub. Out-of-scope IDs raise a 404.
   */
  async composeReview(
    workspaceId: string,
    prId: string,
    body: ComposeReviewBody,
  ): Promise<ComposeReviewResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // Scope-guard: verify all requested finding IDs belong to this workspace + PR.
    let findings: FindingRow[] = [];
    if (body.finding_ids.length > 0) {
      findings = await this.repo.findFindingsByIdsForPr(workspaceId, prId, body.finding_ids);
      if (findings.length !== body.finding_ids.length) {
        throw new NotFoundError('One or more findings not found for this PR');
      }
    }

    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError(
        'github_unavailable',
        'Connect a GitHub token to post a review.',
        400,
      );
    }

    // Pre-filter: partition findings into those whose end_line falls inside the
    // PR diff hunks (GitHub accepts them) vs. those outside (GitHub rejects with 422).
    let comments: { path: string; line: number; body: string }[] = [];
    let omittedCount = 0;

    if (findings.length > 0) {
      const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);

      // Build a lookup: file path → Set of new-side line numbers present in the diff.
      const diffLines = new Map<string, Set<number>>();
      for (const file of diff.files) {
        const lineSet = new Set<number>();
        for (const hunk of file.hunks) {
          for (const ln of hunk.newLineNumbers) {
            lineSet.add(ln);
          }
        }
        diffLines.set(file.path, lineSet);
      }

      const inDiff: FindingRow[] = [];
      const outOfDiff: FindingRow[] = [];
      for (const f of findings) {
        const lineSet = diffLines.get(f.file);
        if (lineSet?.has(f.endLine)) {
          inDiff.push(f);
        } else {
          outOfDiff.push(f);
        }
      }

      omittedCount = outOfDiff.length;
      comments = inDiff.map((f) => ({
        path: f.file,
        line: f.endLine,
        body: buildCommentBody(f),
      }));
    }

    try {
      const result = await gh.postReview(
        { owner: repoRow.owner, name: repoRow.name },
        pull.number,
        {
          body: body.body,
          event: body.verdict,
          comments: comments.length > 0 ? comments : undefined,
        },
      );
      return {
        github_review_id: result.id,
        ...(omittedCount > 0 ? { omitted_count: omittedCount } : {}),
      };
    } catch (err) {
      throw new AppError('github_review_failed', 'Failed to post the review to GitHub.', 400, {
        cause: String(err),
      });
    }
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
