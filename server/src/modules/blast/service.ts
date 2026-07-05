import { and, eq } from 'drizzle-orm';
import type { BlastRadius } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { toBlastRadius } from './helpers.js';

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
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');

    const files = await this.container.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    const changedFiles = files.map((f) => f.path);

    const result = await this.container.repoIntel.getBlastRadius(pr.repoId, changedFiles);
    return toBlastRadius(result);
  }

  /** Repo-scoped (MCP): caller supplies the changed file list explicitly. */
  async buildForRepo(workspaceId: string, repoId: string, files: string[]): Promise<BlastRadius> {
    const repo = await new RepoRepository(this.container.db).getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const result = await this.container.repoIntel.getBlastRadius(repoId, files);
    return toBlastRadius(result);
  }
}
