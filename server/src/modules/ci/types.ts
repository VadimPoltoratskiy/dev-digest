import * as t from '../../db/schema.js';
import { AgentRow } from '../../db/rows.js';

/**
 * Module-local TypeScript row type aliases for the ci/ module.
 *
 * AgentRow is re-exported from db/rows.ts (the central row type registry).
 * SkillRow, CiInstallationRow, and CiRunRow are inferred directly from the
 * Drizzle schema so they stay in sync with any future schema changes.
 */

export type { AgentRow };

export type SkillRow = typeof t.skills.$inferSelect;
export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

/**
 * Insert shape for ci_runs (omits auto-generated `id`).
 * All fields mirror the table columns and are nullable where the column is.
 */
export interface NewCiRunRow {
  ciInstallationId: string | null;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string | null;
  durationMs: number | null;
}
