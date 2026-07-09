import { and, eq } from 'drizzle-orm';
import type { PriorPrList } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { findPriorPrs } from './repository.js';

export class PriorPrsService {
  constructor(private container: Container) {}

  async getPriorPrs(
    workspaceId: string,
    prId: string,
    path: string,
  ): Promise<PriorPrList> {
    const pr = await this.loadPull(workspaceId, prId);
    const rows = await findPriorPrs(this.container.db, pr.repoId, prId, path);
    return {
      items: rows.map((r) => ({
        number:    r.number,
        title:     r.title,
        author:    r.author,
        status:    r.status,
        opened_at: r.openedAt ? r.openedAt.toISOString() : null,
      })),
      // Postgres returns COUNT(*) as a bigint, which node-postgres serializes
      // as a string to avoid precision loss — coerce explicitly, don't trust
      // the (compile-time-only) `number` type on PriorPrRow.total.
      total: Number(rows[0]?.total ?? 0),
    };
  }

  /**
   * Workspace-scoped PR lookup. Mirrors BlastService.loadPull() and
   * WhyService.loadPull() exactly. Throws NotFoundError (→ HTTP 404 via
   * the global error handler) when the PR does not belong to workspaceId.
   */
  private async loadPull(workspaceId: string, prId: string) {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.id, prId),
        ),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    return pr;
  }
}
