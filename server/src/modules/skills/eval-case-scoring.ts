import type { Finding } from '@devdigest/shared';
import { scoreMustFind, scoreMustNotFlag } from '../agents/eval-scorer.js';

export interface SkillEvalExpectedRaw {
  expected_finding_count?: number;
  kind?: 'must_find' | 'must_not_flag' | null;
  file?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  title?: string | null;
  category?: string | null;
  severity?: string | null;
}

/**
 * Pure deterministic scoring for a single skill eval run — no DB, no LLM.
 *
 * When `expected` carries a full file+line-range expectation (kind/file/start_line/end_line all
 * set), scores by the same file+line-range matchers used for agent eval cases
 * (`scoreMustFind`/`scoreMustNotFlag` in `../agents/eval-scorer.js`). Otherwise falls back to the
 * legacy count comparison (`actualFindings.length === expected_finding_count`).
 */
export function scoreSkillEvalCase(expected: SkillEvalExpectedRaw, actualFindings: Finding[]): boolean {
  const hasFindingExpectation =
    expected.kind != null && expected.file != null && expected.start_line != null && expected.end_line != null;

  if (!hasFindingExpectation) {
    return actualFindings.length === (expected.expected_finding_count ?? 1);
  }

  const expectedFinding = {
    file: expected.file!,
    start_line: expected.start_line!,
    end_line: expected.end_line!,
    title: expected.title ?? '',
    severity: expected.severity ?? '',
    category: expected.category ?? '',
  };

  return expected.kind === 'must_find'
    ? scoreMustFind(expectedFinding, actualFindings)
    : scoreMustNotFlag(expectedFinding, actualFindings);
}
