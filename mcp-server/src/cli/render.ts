import { countBlockers } from '@devdigest/reviewer-core';
import type { CiFailOn, Finding, Review, Severity } from '@devdigest/shared';

/** Severity glyphs — same mapping as reviewer-core/src/output/to-review.ts. */
const SEVERITY_EMOJI: Record<Severity, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  SUGGESTION: '🔵',
};

const VERDICT_LABEL: Record<Review['verdict'], string> = {
  request_changes: 'Request changes',
  comment: 'Comment',
  approve: 'Approve',
};

function count(findings: Finding[], sev: Severity): number {
  return findings.reduce((n, f) => n + (f.severity === sev ? 1 : 0), 0);
}

/** One finding block: title line + rationale + optional suggestion. */
function renderFinding(f: Finding): string {
  const loc = f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
  const lines = [
    `  ${SEVERITY_EMOJI[f.severity]} ${f.title} (${f.severity.toLowerCase()}, ${f.category}) — ${f.file}:${loc}`,
    `     ${f.rationale.trim()}`,
  ];
  if (f.suggestion) lines.push(`     Suggestion: ${f.suggestion.trim()}`);
  return lines.join('\n');
}

/** Human-readable terminal report for a grounded review. */
export function renderReview(review: Review, grounding: string): string {
  const { findings } = review;
  const out: string[] = ['', 'DevDigest — working-tree review', '='.repeat(32)];

  if (findings.length === 0) {
    out.push('', 'No findings. ✅');
  } else {
    // Group by file, preserving first-seen order.
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }
    for (const [file, list] of byFile) {
      out.push('', file);
      for (const f of list) out.push(renderFinding(f));
    }
  }

  const summary =
    `${findings.length} finding(s) · ` +
    `${count(findings, 'CRITICAL')} critical · ` +
    `${count(findings, 'WARNING')} warning · ` +
    `${count(findings, 'SUGGESTION')} suggestion`;

  out.push(
    '',
    '-'.repeat(32),
    summary,
    `Verdict: ${VERDICT_LABEL[review.verdict]} · Score: ${review.score}/100`,
    `Citation grounding: ${grounding}`,
    '',
  );
  return out.join('\n');
}

/**
 * Process exit code for the review. Non-zero when findings trip the gate under
 * `failOn` (reuses reviewer-core's deterministic blocker count) so `devdigest
 * review` can gate a git pre-push hook. Default gate is CRITICAL.
 */
export function exitCodeFor(findings: Finding[], failOn: CiFailOn): number {
  return countBlockers(findings, failOn) > 0 ? 1 : 0;
}
