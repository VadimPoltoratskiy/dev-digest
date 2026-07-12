import { describe, it, expect } from 'vitest';
import { rangesOverlap, scoreMustFind, scoreMustNotFlag, computeBatchMetrics } from './eval-scorer.js';
import type { Finding } from '@devdigest/shared';
import type { AgentEvalExpectedFinding } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFinding(file: string, start: number, end: number): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Test finding',
    file,
    start_line: start,
    end_line: end,
    rationale: 'Test rationale',
    confidence: 0.9,
    kind: 'finding',
  };
}

function makeExpected(file: string, start: number, end: number): AgentEvalExpectedFinding {
  return {
    file,
    start_line: start,
    end_line: end,
    title: 'Expected finding',
    severity: 'CRITICAL',
    category: 'security',
  };
}

// ---------------------------------------------------------------------------
// rangesOverlap
// ---------------------------------------------------------------------------

describe('rangesOverlap', () => {
  it('returns true when ranges share a single boundary line', () => {
    // [10,15] and [15,20] overlap at line 15
    expect(rangesOverlap(10, 15, 15, 20)).toBe(true);
  });

  it('returns false when ranges are adjacent but do not share a line', () => {
    // [10,14] and [15,20] — gap between 14 and 15
    expect(rangesOverlap(10, 14, 15, 20)).toBe(false);
  });

  it('returns true when one range is fully contained within the other', () => {
    // [5,25] fully contains [10,20]
    expect(rangesOverlap(5, 25, 10, 20)).toBe(true);
    expect(rangesOverlap(10, 20, 5, 25)).toBe(true);
  });

  it('returns false when ranges are fully disjoint', () => {
    // [1,5] and [10,20] — no overlap
    expect(rangesOverlap(1, 5, 10, 20)).toBe(false);
  });

  it('returns true for identical single-line ranges', () => {
    expect(rangesOverlap(11, 11, 11, 11)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreMustFind
// ---------------------------------------------------------------------------

describe('scoreMustFind', () => {
  it('returns true when a finding matches the file and overlapping range', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    const actuals = [makeFinding('src/config.ts', 11, 11)];
    expect(scoreMustFind(exp, actuals)).toBe(true);
  });

  it('returns false when no finding matches the file', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    const actuals = [makeFinding('src/other.ts', 11, 11)];
    expect(scoreMustFind(exp, actuals)).toBe(false);
  });

  it('returns false when file matches but range is adjacent (not overlapping)', () => {
    const exp = makeExpected('src/config.ts', 10, 14);
    const actuals = [makeFinding('src/config.ts', 15, 20)];
    expect(scoreMustFind(exp, actuals)).toBe(false);
  });

  it('returns false with an empty actuals list', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    expect(scoreMustFind(exp, [])).toBe(false);
  });

  it('returns true when one of several findings matches', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    const actuals = [
      makeFinding('src/other.ts', 10, 15),
      makeFinding('src/config.ts', 12, 12),
    ];
    expect(scoreMustFind(exp, actuals)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreMustNotFlag
// ---------------------------------------------------------------------------

describe('scoreMustNotFlag', () => {
  it('returns true when no actual finding overlaps the expected file+range', () => {
    const exp = makeExpected('src/other.ts', 1, 5);
    const actuals = [makeFinding('src/config.ts', 11, 11)];
    expect(scoreMustNotFlag(exp, actuals)).toBe(true);
  });

  it('returns false when an actual finding overlaps', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    const actuals = [makeFinding('src/config.ts', 11, 11)];
    expect(scoreMustNotFlag(exp, actuals)).toBe(false);
  });

  it('returns true with an empty actuals list', () => {
    const exp = makeExpected('src/config.ts', 10, 15);
    expect(scoreMustNotFlag(exp, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeBatchMetrics
// ---------------------------------------------------------------------------

describe('computeBatchMetrics', () => {
  it('returns null recall when there are no must_find cases', () => {
    const results = [
      { kind: 'must_not_flag' as const, pass: true, candidatesKept: 1, candidatesDropped: 0 },
    ];
    const { recall } = computeBatchMetrics(results);
    expect(recall).toBeNull();
  });

  it('returns null precision when there are no must_not_flag cases', () => {
    const results = [
      { kind: 'must_find' as const, pass: true, candidatesKept: 1, candidatesDropped: 0 },
    ];
    const { precision } = computeBatchMetrics(results);
    expect(precision).toBeNull();
  });

  it('returns null citation_accuracy when there are no candidates at all', () => {
    const results = [
      { kind: 'must_find' as const, pass: false, candidatesKept: 0, candidatesDropped: 0 },
    ];
    const { citation_accuracy } = computeBatchMetrics(results);
    expect(citation_accuracy).toBeNull();
  });

  it('computes correct recall fraction (2 passed of 3 must_find)', () => {
    const results = [
      { kind: 'must_find' as const, pass: true, candidatesKept: 1, candidatesDropped: 0 },
      { kind: 'must_find' as const, pass: true, candidatesKept: 1, candidatesDropped: 0 },
      { kind: 'must_find' as const, pass: false, candidatesKept: 0, candidatesDropped: 1 },
    ];
    const { recall } = computeBatchMetrics(results);
    expect(recall).toBeCloseTo(2 / 3);
  });

  it('computes correct precision fraction (1 passed of 2 must_not_flag)', () => {
    const results = [
      { kind: 'must_not_flag' as const, pass: true, candidatesKept: 0, candidatesDropped: 0 },
      { kind: 'must_not_flag' as const, pass: false, candidatesKept: 1, candidatesDropped: 0 },
    ];
    const { precision } = computeBatchMetrics(results);
    expect(precision).toBeCloseTo(0.5);
  });

  it('computes correct citation_accuracy from kept / (kept + dropped)', () => {
    const results = [
      { kind: 'must_find' as const, pass: true, candidatesKept: 2, candidatesDropped: 1 },
      { kind: 'must_not_flag' as const, pass: false, candidatesKept: 1, candidatesDropped: 1 },
    ];
    // total_kept = 3, total_candidates = 5
    const { citation_accuracy } = computeBatchMetrics(results);
    expect(citation_accuracy).toBeCloseTo(3 / 5);
  });

  it('returns all-null when results is empty', () => {
    const { recall, precision, citation_accuracy } = computeBatchMetrics([]);
    expect(recall).toBeNull();
    expect(precision).toBeNull();
    expect(citation_accuracy).toBeNull();
  });

  it('returns recall=0 and citation_accuracy=null when all must_find cases error (pass=false, no candidates)', () => {
    const results = [
      { kind: 'must_find' as const, pass: false, candidatesKept: 0, candidatesDropped: 0 },
      { kind: 'must_find' as const, pass: false, candidatesKept: 0, candidatesDropped: 0 },
    ];
    const { recall, citation_accuracy } = computeBatchMetrics(results);
    expect(recall).toBe(0);
    expect(citation_accuracy).toBeNull();
  });
});
