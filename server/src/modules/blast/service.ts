import { and, eq } from 'drizzle-orm';
import type { BlastExplanation, BlastRadius } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { BlastExplainer } from './explainer.js';
import { toBlastRadius } from './helpers.js';
import { getBlastExplanation, upsertBlastExplanation } from './repository.js';

interface Logger {
  info(obj: object, msg: string): void;
}

/**
 * Blast radius: which changed symbols a PR touches, who calls them, and which
 * HTTP endpoints/crons those callers reach. Reads the ready-made repo-intel
 * index through `container.repoIntel.getBlastRadius` — no analysis, no model
 * call. Just loads the changed files and maps the facade result to the API
 * contract.
 */
export class BlastService {
  constructor(private container: Container) {}

  /** PR-scoped: derive changed files from `pr_files`, then read the index. */
  async buildForPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    const pr = await this.loadPull(workspaceId, prId);

    const files = await this.container.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    const changedFiles = files.map((f) => f.path);

    const result = await this.container.repoIntel.getBlastRadius(pr.repoId, changedFiles);
    return toBlastRadius(result);
  }

  /** Cached AI explanation for a PR, or null if none has been generated. */
  async getExplanation(workspaceId: string, prId: string): Promise<BlastExplanation | null> {
    await this.loadPull(workspaceId, prId); // 404 guard + workspace scope
    return getBlastExplanation(this.container.db, prId);
  }

  /**
   * The feature's one LLM call: build the deterministic map, ask the cheap model
   * to explain it in a paragraph, persist, and return the stored record.
   */
  async explainBlast(
    workspaceId: string,
    prId: string,
    opts: { logger?: Logger } = {},
  ): Promise<BlastExplanation> {
    const blast = await this.buildForPull(workspaceId, prId); // 404 guard inside
    const result = await new BlastExplainer(this.container).explain(workspaceId, blast, opts);
    await upsertBlastExplanation(this.container.db, prId, {
      explanation: result.explanation,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });
    const saved = await getBlastExplanation(this.container.db, prId);
    return saved!;
  }

  private async loadPull(workspaceId: string, prId: string) {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');
    return pr;
  }

  /** Repo-scoped (MCP): caller supplies the changed file list explicitly. */
  async buildForRepo(workspaceId: string, repoId: string, files: string[]): Promise<BlastRadius> {
    const repo = await new RepoRepository(this.container.db).getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const result = await this.container.repoIntel.getBlastRadius(repoId, files);
    return toBlastRadius(result);
  }
}
