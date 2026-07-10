import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalDashboardRaw } from './helpers.js';

/**
 * Data-access for the global evals dashboard.
 * Returns raw DB rows — all DTO assembly belongs in helpers.ts.
 */
export async function queryEvalDashboardData(
  db: Db,
  workspaceId: string,
  ownerId?: string,
): Promise<EvalDashboardRaw> {
  // 1. Count total eval cases scoped to this workspace (and optional owner)
  const casesWhere = ownerId
    ? and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, ownerId),
      )
    : and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent'));

  const allCases = await db.select({ id: t.evalCases.id }).from(t.evalCases).where(casesWhere);
  const casesTotal = allCases.length;
  const caseIds = allCases.map((c) => c.id);

  if (caseIds.length === 0) {
    return { caseIds, casesTotal, runs: [], ownerId };
  }

  // 2. Load eval runs joined with case names, newest first
  const runsWhere = ownerId
    ? and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, ownerId),
      )
    : and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent'));

  const runs = await db
    .select({
      id: t.evalRuns.id,
      caseId: t.evalRuns.caseId,
      ranAt: t.evalRuns.ranAt,
      actualOutput: t.evalRuns.actualOutput,
      pass: t.evalRuns.pass,
      recall: t.evalRuns.recall,
      precision: t.evalRuns.precision,
      citationAccuracy: t.evalRuns.citationAccuracy,
      durationMs: t.evalRuns.durationMs,
      costUsd: t.evalRuns.costUsd,
      caseName: t.evalCases.name,
    })
    .from(t.evalRuns)
    .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
    .where(runsWhere)
    .orderBy(desc(t.evalRuns.ranAt));

  return { caseIds, casesTotal, runs, ownerId };
}
