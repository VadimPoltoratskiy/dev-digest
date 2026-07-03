import { and, eq } from 'drizzle-orm';
import type { SmartDiffFile, SmartDiffResponse, SmartDiffRole } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from '../reviews/service.js';
import { classifyFile } from './classifier.js';
import { latestBatchFindings } from './findings-batch.js';
import { TOTAL_LINES_TOO_BIG_THRESHOLD } from './patterns.js';

const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Smart Diff: groups a PR's files by risk (core/wiring/boilerplate) and
 * attaches the latest review's finding lines per file. Purely a deterministic
 * composition of already-fetched data (PR files + persisted findings) — no
 * model call.
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  async buildForPull(workspaceId: string, prId: string): Promise<SmartDiffResponse> {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');

    const files = await this.container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
    const reviews = await new ReviewService(this.container).reviewsForPull(workspaceId, prId);
    const findings = latestBatchFindings(reviews);

    const byRole = new Map<SmartDiffRole, SmartDiffFile[]>(ROLE_ORDER.map((role) => [role, []]));
    let totalLines = 0;
    for (const f of files) {
      const role = classifyFile(f.path);
      const findingLines = [
        ...new Set(findings.filter((fd) => fd.file === f.path).map((fd) => fd.start_line)),
      ].sort((a, b) => a - b);
      byRole.get(role)!.push({
        path: f.path,
        pseudocode_summary: null,
        additions: f.additions,
        deletions: f.deletions,
        finding_lines: findingLines,
      });
      totalLines += f.additions + f.deletions;
    }

    return {
      groups: ROLE_ORDER.map((role) => ({ role, files: byRole.get(role)! })),
      split_suggestion: {
        too_big: totalLines > TOTAL_LINES_TOO_BIG_THRESHOLD,
        total_lines: totalLines,
        proposed_splits: [],
      },
    };
  }
}
