import { eq } from 'drizzle-orm';
import type { BlastExplanation } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Data access for the optional AI blast explanation (`pr_blast_explanation`).
 * One row per PR; upserted on (re)generate, read back on GET.
 */

export interface BlastExplanationSaveParams {
  explanation: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export async function upsertBlastExplanation(
  db: Db,
  prId: string,
  params: BlastExplanationSaveParams,
): Promise<void> {
  const values = {
    prId,
    explanation: params.explanation,
    model: params.model,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    costUsd: params.costUsd,
    generatedAt: new Date(),
  };
  await db
    .insert(t.prBlastExplanation)
    .values(values)
    .onConflictDoUpdate({
      target: t.prBlastExplanation.prId,
      set: {
        explanation: values.explanation,
        model: values.model,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        costUsd: values.costUsd,
        generatedAt: values.generatedAt,
      },
    });
}

export async function getBlastExplanation(db: Db, prId: string): Promise<BlastExplanation | null> {
  const [row] = await db
    .select()
    .from(t.prBlastExplanation)
    .where(eq(t.prBlastExplanation.prId, prId));
  if (!row) return null;
  return {
    explanation: row.explanation,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    generated_at: row.generatedAt.toISOString(),
  };
}
