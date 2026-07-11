import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalDashboardAgentsRaw, EvalDashboardRaw } from './helpers.js';

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

/**
 * Data-access for the workspace eval-dashboard's per-agent agent list
 * (`GET /evals/dashboard/agents`). One IN-query per level (agents → cases →
 * runs) rather than N+1 per-agent round trips. Returns raw rows — all
 * grouping/DTO assembly belongs in `helpers.ts`'s `assembleAgentsSummary`.
 */
export async function queryEvalDashboardAgentsData(
  db: Db,
  workspaceId: string,
): Promise<EvalDashboardAgentsRaw> {
  const agentRows = await db
    .select({
      id: t.agents.id,
      name: t.agents.name,
      provider: t.agents.provider,
      model: t.agents.model,
      version: t.agents.version,
    })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));

  if (agentRows.length === 0) {
    return { agentRows: [], caseRows: [], runRows: [] };
  }

  const agentIds = agentRows.map((a) => a.id);

  const caseRows = await db
    .select({ id: t.evalCases.id, ownerId: t.evalCases.ownerId })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        inArray(t.evalCases.ownerId, agentIds),
      ),
    );

  if (caseRows.length === 0) {
    return { agentRows, caseRows: [], runRows: [] };
  }

  const runRows = await db
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
      ownerId: t.evalCases.ownerId,
    })
    .from(t.evalRuns)
    .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        inArray(t.evalCases.ownerId, agentIds),
      ),
    )
    .orderBy(desc(t.evalRuns.ranAt));

  return { agentRows, caseRows, runRows };
}
