import { and, eq, ne, desc, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface PriorPrRow {
  number:   number;
  title:    string;
  author:   string;
  status:   string;
  openedAt: Date | null;
  total:    number;
}

/**
 * Join prFiles ⋈ pullRequests, filter by path + repoId + exclude current prId,
 * order by openedAt DESC (NULLs last by Postgres default for DESC), cap at 10.
 * COUNT(*) OVER() gives the pre-cap total in the same query — no second round-trip.
 */
export async function findPriorPrs(
  db: Db,
  repoId: string,
  prId: string,
  path: string,
): Promise<PriorPrRow[]> {
  return db
    .select({
      number:   t.pullRequests.number,
      title:    t.pullRequests.title,
      author:   t.pullRequests.author,
      status:   t.pullRequests.status,
      openedAt: t.pullRequests.openedAt,
      total:    sql<number>`count(*) over()`,
    })
    .from(t.prFiles)
    .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.prFiles.path, path),
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, prId),
      ),
    )
    .orderBy(desc(t.pullRequests.openedAt))
    .limit(10);
}
