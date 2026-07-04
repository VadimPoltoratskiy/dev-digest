import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export interface IntentRecord extends Intent {
  classifierModel: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  savedTokensEstimate: number | null;
  classifiedAt: string | null;
}

export interface IntentSaveParams extends Intent {
  classifierModel?: string;
  tokensIn?: number;
  tokensOut?: number;
  savedTokensEstimate?: number;
}

export async function upsertIntent(db: Db, prId: string, params: IntentSaveParams): Promise<void> {
  const values = {
    prId,
    intent: params.intent,
    inScope: params.in_scope,
    outOfScope: params.out_of_scope,
    riskAreas: params.risk_areas,
    classifierModel: params.classifierModel ?? null,
    tokensIn: params.tokensIn ?? null,
    tokensOut: params.tokensOut ?? null,
    savedTokensEstimate: params.savedTokensEstimate ?? null,
    classifiedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

export async function getIntent(db: Db, prId: string): Promise<IntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    risk_areas: row.riskAreas,
    classifierModel: row.classifierModel,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    savedTokensEstimate: row.savedTokensEstimate,
    classifiedAt: row.classifiedAt?.toISOString() ?? null,
  };
}
