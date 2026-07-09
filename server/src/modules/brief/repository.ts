import { desc, eq } from 'drizzle-orm';
import type { Brief, BriefTimelineEntry } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Data access for the PR brief cache (`pr_brief`).
 * One row per (prId, headSha) — upserted on (re)generate at a given commit,
 * read back (latest) on GET, or listed in full as the BriefTimeline history.
 */

export interface BriefSaveParams {
  json: Brief;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/**
 * Fetch the latest cached brief for a PR (across all head SHAs), or null if
 * none exists. Returns the raw JSON cast to `Brief` — the service layer
 * validated this on write, so re-parsing here is not required.
 */
export async function getBrief(db: Db, prId: string): Promise<Brief | null> {
  const [row] = await db
    .select()
    .from(t.prBrief)
    .where(eq(t.prBrief.prId, prId))
    .orderBy(desc(t.prBrief.generatedAt))
    .limit(1);
  if (!row) return null;
  return row.json as Brief;
}

/**
 * List every generated brief for a PR, newest first — one entry per distinct
 * head SHA the PR was briefed at.
 */
export async function listBriefHistory(db: Db, prId: string): Promise<BriefTimelineEntry[]> {
  const rows = await db
    .select()
    .from(t.prBrief)
    .where(eq(t.prBrief.prId, prId))
    .orderBy(desc(t.prBrief.generatedAt));

  return rows.map((row) => ({
    head_sha: row.headSha,
    brief: row.json as Brief,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    generated_at: row.generatedAt.toISOString(),
  }));
}

/**
 * Upsert the brief cache row for a PR at a given head SHA (ON CONFLICT DO
 * UPDATE on the (prId, headSha) unique index). Regenerating at an unchanged
 * head SHA updates that SHA's row in place; a new head SHA inserts a new row,
 * retaining prior generations as history (BriefTimeline).
 *
 * Always writes `generatedAt: new Date()` — the wall-clock time of this
 * specific generation, not a timestamp from the LLM response.
 */
export async function upsertBrief(
  db: Db,
  prId: string,
  headSha: string,
  params: BriefSaveParams,
): Promise<void> {
  const values = {
    prId,
    headSha,
    json: params.json,
    model: params.model,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    costUsd: params.costUsd,
    generatedAt: new Date(),
  };
  await db
    .insert(t.prBrief)
    .values(values)
    .onConflictDoUpdate({
      target: [t.prBrief.prId, t.prBrief.headSha],
      set: {
        json: values.json,
        model: values.model,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        costUsd: values.costUsd,
        generatedAt: values.generatedAt,
      },
    });
}
