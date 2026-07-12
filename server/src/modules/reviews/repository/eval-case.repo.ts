import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * Data-access helpers for turning a grounded finding into an agent eval case.
 * These functions are standalone (not on ReviewRepository) because they cross
 * the reviews→eval domain boundary; the reviews service calls them directly.
 */

/**
 * Fetch the unified-diff patch for a single file in a PR's `pr_files` table.
 * Returns:
 *   - `undefined` when no row exists for (prId, filePath)
 *   - `null`      when the row exists but the `patch` column is null
 *   - `string`    the raw patch text
 */
export async function getPrFilePatch(
  db: Db,
  prId: string,
  filePath: string,
): Promise<string | null | undefined> {
  const [row] = await db
    .select({ patch: t.prFiles.patch })
    .from(t.prFiles)
    .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, filePath)));
  if (row === undefined) return undefined;
  return row.patch;
}

/**
 * Insert a new eval case owned by an agent (`owner_kind='agent'`).
 * Returns the persisted row.
 */
export async function insertFindingEvalCase(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string;
    name: string;
    inputDiff: string;
    expectedOutput: unknown;
  },
): Promise<typeof t.evalCases.$inferSelect> {
  const [row] = await db
    .insert(t.evalCases)
    .values({
      workspaceId: values.workspaceId,
      ownerKind: 'agent',
      ownerId: values.agentId,
      name: values.name,
      inputDiff: values.inputDiff,
      expectedOutput: values.expectedOutput as object,
    })
    .returning();
  return row!;
}
