import type { Finding } from '@devdigest/shared';
import type { AgentEvalExpectedFinding } from '@devdigest/shared';

/**
 * Pure deterministic scoring functions for agent eval batches.
 * No DB access, no HTTP, no LLM calls.
 */

/** True when [s1,e1] and [s2,e2] share at least one line. */
export function rangesOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  return Math.max(s1, s2) <= Math.min(e1, e2);
}

/**
 * AC-8: must_find passes when the agent produced at least one finding
 * with the same file and overlapping line range.
 */
export function scoreMustFind(
  expected: AgentEvalExpectedFinding,
  actualFindings: Finding[],
): boolean {
  return actualFindings.some(
    (f) =>
      f.file === expected.file &&
      rangesOverlap(f.start_line, f.end_line, expected.start_line, expected.end_line),
  );
}

/**
 * AC-9: must_not_flag passes when NO actual finding overlaps the expected file+range.
 */
export function scoreMustNotFlag(
  expected: AgentEvalExpectedFinding,
  actualFindings: Finding[],
): boolean {
  return !scoreMustFind(expected, actualFindings);
}

/**
 * Compute batch-level metrics from per-case results.
 *
 * AC-5: recall    = passed_must_find / total_must_find       (null if no must_find cases)
 * AC-6: precision = passed_must_not_flag / total_must_not_flag (null if no must_not_flag cases)
 * AC-7: citation_accuracy = total_kept / (total_kept + total_dropped)  (null if zero candidates)
 */
export function computeBatchMetrics(
  results: Array<{
    kind: 'must_find' | 'must_not_flag';
    pass: boolean;
    candidatesKept: number;
    candidatesDropped: number;
  }>,
): { recall: number | null; precision: number | null; citation_accuracy: number | null } {
  const mustFind = results.filter((r) => r.kind === 'must_find');
  const mustNotFlag = results.filter((r) => r.kind === 'must_not_flag');

  const recall =
    mustFind.length === 0 ? null : mustFind.filter((r) => r.pass).length / mustFind.length;

  const precision =
    mustNotFlag.length === 0
      ? null
      : mustNotFlag.filter((r) => r.pass).length / mustNotFlag.length;

  const totalKept = results.reduce((n, r) => n + r.candidatesKept, 0);
  const totalCandidates = results.reduce((n, r) => n + r.candidatesKept + r.candidatesDropped, 0);
  const citation_accuracy = totalCandidates === 0 ? null : totalKept / totalCandidates;

  return { recall, precision, citation_accuracy };
}
