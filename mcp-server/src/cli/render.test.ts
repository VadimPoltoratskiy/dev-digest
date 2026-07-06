import { describe, expect, it } from 'vitest';
import type { Finding, Review, Severity } from '@devdigest/shared';
import { exitCodeFor, renderReview } from './render.js';

function finding(severity: Severity, over: Partial<Finding> = {}): Finding {
  return {
    id: over.id ?? `f-${severity}`,
    severity,
    category: 'bug',
    title: `${severity} thing`,
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'because reasons',
    suggestion: null,
    confidence: 0.9,
    ...over,
  };
}

function review(findings: Finding[], over: Partial<Review> = {}): Review {
  return { verdict: 'comment', summary: 'ok', score: 80, findings, ...over };
}

describe('exitCodeFor', () => {
  it('exits 1 when a CRITICAL finding trips the default critical gate', () => {
    expect(exitCodeFor([finding('CRITICAL')], 'critical')).toBe(1);
  });

  it('exits 0 when only a WARNING exists under the critical gate', () => {
    expect(exitCodeFor([finding('WARNING')], 'critical')).toBe(0);
  });

  it('exits 1 for a WARNING when the gate is lowered to warning', () => {
    expect(exitCodeFor([finding('WARNING')], 'warning')).toBe(1);
  });

  it('always exits 0 under the never gate, even with a CRITICAL', () => {
    expect(exitCodeFor([finding('CRITICAL')], 'never')).toBe(0);
  });

  it('exits 0 when there are no findings', () => {
    expect(exitCodeFor([], 'critical')).toBe(0);
  });
});

describe('renderReview', () => {
  it('renders findings grouped by file with severity emoji, location and suggestion', () => {
    const out = renderReview(
      review([
        finding('CRITICAL', { file: 'src/a.ts', start_line: 3, end_line: 7, suggestion: 'do X' }),
        finding('SUGGESTION', { file: 'src/b.ts', title: 'nit' }),
      ]),
      '2/2 passed',
    );
    expect(out).toContain('src/a.ts:3-7');
    expect(out).toContain('🔴');
    expect(out).toContain('🔵');
    expect(out).toContain('Suggestion: do X');
    expect(out).toContain('src/b.ts');
  });

  it('renders the summary counts, verdict, score and grounding', () => {
    const out = renderReview(
      review([finding('CRITICAL'), finding('WARNING')], { verdict: 'request_changes', score: 42 }),
      '3/4 passed',
    );
    expect(out).toContain('2 finding(s) · 1 critical · 1 warning · 0 suggestion');
    expect(out).toContain('Request changes');
    expect(out).toContain('42/100');
    expect(out).toContain('Citation grounding: 3/4 passed');
  });

  it('shows a clean no-findings message', () => {
    const out = renderReview(review([], { verdict: 'approve' }), '0/0 passed');
    expect(out).toContain('No findings');
    expect(out).toContain('0 finding(s)');
  });
});
