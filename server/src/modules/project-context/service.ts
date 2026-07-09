import { readFile, stat, glob } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import { ValidationError, NotFoundError } from '../../platform/errors.js';
import { RepoIntelRepository } from '../repo-intel/repository.js';
import * as t from '../../db/schema.js';
import type { SpecFile, IndexStatus } from '@devdigest/shared';

/**
 * Project Context — recursively finds markdown documentation (specs/docs/
 * insights, by default) in a repo's clone and surfaces it for manual
 * attachment to agents/skills. No LLM call: this module only reads files off
 * disk. See run-executor.ts for where attached documents actually get read
 * again (capped, wrapped) and injected into the review prompt.
 */
export class ProjectContextService {
  private repoIntelRepo: RepoIntelRepository;

  constructor(private container: Container) {
    this.repoIntelRepo = new RepoIntelRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<SpecFile[]> {
    const clonePath = await this.resolveClonePath(repoId);
    const files = await discoverContextFiles(clonePath, this.container.config.contextRoots);
    const usedByCounts = await this.usedByCounts(workspaceId);

    const specFiles: SpecFile[] = [];
    for (const { path, root } of files) {
      const absPath = join(clonePath, path);
      const [content, stats] = await Promise.all([
        readFile(absPath, 'utf8').catch(() => null),
        stat(absPath).catch(() => null),
      ]);
      specFiles.push({
        path,
        content,
        size: stats?.size ?? null,
        updated_at: stats?.mtime.toISOString() ?? null,
        root,
        used_by_count: usedByCounts.get(path) ?? 0,
      });
    }
    return specFiles;
  }

  /**
   * Re-scan the clone dir for markdown documents. Synchronous — this lesson
   * does not chunk/embed documents, so there is no background job; the
   * `IndexStatus` shape is filled in as if the (unused) embedding stage were
   * skipped, matching the codebase's "unused states sit empty" convention.
   */
  async reindex(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const clonePath = await this.resolveClonePath(repoId);
    const files = await discoverContextFiles(clonePath, this.container.config.contextRoots);
    return {
      status: 'done',
      pct: 100,
      message: null,
      chunks_indexed: files.length,
    };
  }

  private async resolveClonePath(repoId: string): Promise<string> {
    const repoBasics = await this.repoIntelRepo.getRepoBasics(repoId);
    if (!repoBasics) throw new NotFoundError('Repository not found');
    if (!repoBasics.clonePath) {
      throw new ValidationError('Repository is not cloned yet. Please wait for the clone to finish.');
    }
    return repoBasics.clonePath;
  }

  /** Count how many agents + skills in the workspace have each path attached. */
  private async usedByCounts(workspaceId: string): Promise<Map<string, number>> {
    const [agentRows, skillRows] = await Promise.all([
      this.container.db
        .select({ contextDocs: t.agents.contextDocs })
        .from(t.agents)
        .where(eq(t.agents.workspaceId, workspaceId)),
      this.container.db
        .select({ contextDocs: t.skills.contextDocs })
        .from(t.skills)
        .where(eq(t.skills.workspaceId, workspaceId)),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...agentRows, ...skillRows]) {
      for (const path of row.contextDocs ?? []) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    return counts;
  }
}

/**
 * Recursively find markdown files under any of `roots` (matched at any depth)
 * inside `clonePath`, e.g. `**\/{specs,docs,insights}/**\/*.md`. Best-effort:
 * an unreadable/missing root is skipped, never throws.
 */
async function discoverContextFiles(
  clonePath: string,
  roots: string[],
): Promise<Array<{ path: string; root: string }>> {
  if (roots.length === 0) return [];
  const pattern = roots.length === 1 ? `**/${roots[0]}/**/*.md` : `**/{${roots.join(',')}}/**/*.md`;

  const found: Array<{ path: string; root: string }> = [];
  try {
    for await (const entry of glob(pattern, { cwd: clonePath })) {
      const relPath = entry.replace(/\\/g, '/');
      const root = roots.find((r) => relPath.includes(`/${r}/`) || relPath.startsWith(`${r}/`)) ?? roots[0]!;
      found.push({ path: relPath, root });
    }
  } catch {
    // glob throws on unsupported patterns in some Node versions; degrade to empty.
  }
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}
