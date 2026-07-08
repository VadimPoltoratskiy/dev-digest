import { and, eq } from 'drizzle-orm';
import type { WhyTimeline, WhyEvent, RepoRef, BlameLine, GitCommit } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoIntelRepository } from '../repo-intel/repository.js';
import { getBrief } from '../brief/repository.js';

type PullRow = typeof t.pullRequests.$inferSelect;

/**
 * WhyService — git-why blame drawer (SPEC-04).
 *
 * Walks git blame/log for a file/line (deterministic, via container.git — no
 * LLM call) and, for any commit whose message references a PR number,
 * enriches that event with the linked PR's already-generated Brief (why +
 * file-scoped risks), read via the brief module's existing getBrief. Purely
 * a read/compose layer over data SPEC-01/02/03 already produce.
 */
export class WhyService {
  private repoIntelRepo: RepoIntelRepository;

  constructor(private container: Container) {
    this.repoIntelRepo = new RepoIntelRepository(container.db);
  }

  async getTimeline(
    workspaceId: string,
    prId: string,
    file: string,
    line: number,
  ): Promise<WhyTimeline> {
    const pull = await this.loadPull(workspaceId, prId); // 404 guard + workspace scope

    const repoBasics = await this.repoIntelRepo.getRepoBasics(pull.repoId);
    if (!repoBasics || !repoBasics.clonePath) {
      return emptyTimeline(file, line, 'Repository not cloned yet.');
    }
    const ref: RepoRef = { owner: repoBasics.owner, name: repoBasics.name };

    let blameLines: BlameLine[];
    let commits: GitCommit[];
    try {
      [blameLines, commits] = await Promise.all([
        this.container.git.blame(ref, file),
        this.container.git.log(ref, file),
      ]);
    } catch {
      // Missing/renamed/binary file, or any other git failure — degrade to
      // an empty (not erroring) timeline (AC-6).
      return emptyTimeline(file, line, 'No history available for this line.');
    }

    if (commits.length === 0) {
      return emptyTimeline(file, line, 'No commits found for this line.');
    }

    const blameLine = blameLines.find((b) => b.line === line) ?? null;

    const events: WhyEvent[] = [];
    for (const c of commits) {
      const pr_number = parsePrNumber(c.message);
      let event: WhyEvent = {
        sha: c.sha,
        summary: firstLine(c.message),
        author: c.author,
        date: c.date,
        pr_number,
        is_blame_head: blameLine != null && c.sha === blameLine.sha,
      };
      if (pr_number != null) {
        const enrichment = await this.resolveEnrichment(pull.repoId, pr_number, file);
        if (enrichment) event = { ...event, ...enrichment };
      }
      events.push(event);
    }

    // blame field: reuse the matching enriched event so it carries the same
    // rationale/risks — never construct it separately (AC-4).
    let blame: WhyEvent | null = events.find((e) => e.is_blame_head) ?? null;
    if (!blame && blameLine) {
      // blame() named a sha log() didn't return (depth mismatch) — fall back
      // to a minimal event built directly from the BlameLine.
      blame = {
        sha: blameLine.sha,
        summary: firstLine(blameLine.summary),
        author: blameLine.author,
        date: blameLine.date,
        pr_number: parsePrNumber(blameLine.summary),
        is_blame_head: true,
      };
    }

    const summary = summaryFor(events.length, blame);

    return { file, line, blame, events, summary };
  }

  /**
   * Workspace-scoped PR lookup. Mirrors BriefService.loadPull() exactly.
   * Throws NotFoundError when the PR doesn't belong to the workspace (AC-5).
   */
  private async loadPull(workspaceId: string, prId: string): Promise<PullRow> {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');
    return pr;
  }

  /**
   * Resolve a commit's pr_number to a PR row in the same repo, then read its
   * generated Brief (if any). Returns null at any unresolved step — no error,
   * no new LLM call (AC-3, AC-7).
   */
  private async resolveEnrichment(
    repoId: string,
    prNumber: number,
    file: string,
  ): Promise<{ rationale: string; risks: WhyEvent['risks'] } | null> {
    const [linkedPr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, prNumber)));
    if (!linkedPr) return null;

    const brief = await getBrief(this.container.db, linkedPr.id);
    if (!brief) return null;

    return {
      rationale: brief.why,
      risks: brief.risks.filter((r) => r.file_refs.includes(file)),
    };
  }
}

/** First line of a (possibly multi-line) commit message. */
function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

/**
 * PR number parsed from a commit message: prefers the parenthesised form
 * GitHub's squash-merge default uses ("Title (#123)"), falling back to a bare
 * "#123" reference anywhere in the message.
 */
export function parsePrNumber(message: string): number | null {
  const parenMatch = message.match(/\(#(\d+)\)/);
  if (parenMatch) return Number(parenMatch[1]);
  const bareMatch = message.match(/#(\d+)/);
  if (bareMatch) return Number(bareMatch[1]);
  return null;
}

function emptyTimeline(file: string, line: number, summary: string): WhyTimeline {
  return { file, line, blame: null, events: [], summary };
}

function summaryFor(count: number, blame: WhyEvent | null): string {
  const commitWord = count === 1 ? 'commit' : 'commits';
  if (!blame) return `${count} ${commitWord} touch this file.`;
  return `${count} ${commitWord} touch this file; last changed by ${blame.author} in ${blame.sha.slice(0, 7)}.`;
}
