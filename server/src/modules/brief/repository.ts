import { eq } from 'drizzle-orm';
import type { Brief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Data access for the PR brief cache (`pr_brief`).
 * One row per PR; upserted on (re)generate, read back on GET.
 */

export interface BriefSaveParams {
  json: Brief;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/**
 * Fetch the cached brief for a PR, or null if none exists.
 * Returns the raw JSON cast to `Brief` — the service layer validated this on
 * write, so re-parsing here is not required.
 */
export async function getBrief(db: Db, prId: string): Promise<Brief | null> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return null;
  return row.json as Brief;
}

/**
 * Upsert the brief cache row for a PR (ON CONFLICT DO UPDATE).
 * Always writes `generatedAt: new Date()` — the wall-clock time of this
 * specific generation, not a timestamp from the LLM response.
 */
export async function upsertBrief(
  db: Db,
  prId: string,
  params: BriefSaveParams,
): Promise<void> {
  const values = {
    prId,
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
      target: t.prBrief.prId,
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
