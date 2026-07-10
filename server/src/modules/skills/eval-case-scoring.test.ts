import { describe, it, expect } from 'vitest';
import { scoreSkillEvalCase } from './eval-case-scoring.js';
import type { Finding } from '@devdigest/shared';

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

describe('scoreSkillEvalCase — legacy count-based path', () => {
  it('passes when actual finding count matches expected_finding_count', () => {
    const findings = [makeFinding('a.ts', 1, 2)];
    expect(scoreSkillEvalCase({ expected_finding_count: 1 }, findings)).toBe(true);
  });

  it('fails when actual finding count does not match expected_finding_count', () => {
    const findings = [makeFinding('a.ts', 1, 2), makeFinding('b.ts', 3, 4)];
    expect(scoreSkillEvalCase({ expected_finding_count: 1 }, findings)).toBe(false);
  });

  it('defaults expected_finding_count to 1 when absent', () => {
    expect(scoreSkillEvalCase({}, [makeFinding('a.ts', 1, 2)])).toBe(true);
    expect(scoreSkillEvalCase({}, [])).toBe(false);
  });

  it('falls back to count-based scoring when the finding expectation is only partially set', () => {
    // kind set but file/start_line/end_line missing — not a complete finding expectation.
    const findings = [makeFinding('a.ts', 1, 2)];
    expect(
      scoreSkillEvalCase({ kind: 'must_find', expected_finding_count: 1 }, findings),
    ).toBe(true);
  });
});

describe('scoreSkillEvalCase — file+line-range path', () => {
  it('must_find passes when a finding overlaps the expected file+range', () => {
    const findings = [makeFinding('server/src/routes.ts', 40, 45)];
    expect(
      scoreSkillEvalCase(
        { kind: 'must_find', file: 'server/src/routes.ts', start_line: 42, end_line: 42 },
        findings,
      ),
    ).toBe(true);
  });

  it('must_find fails when no finding overlaps the expected file+range', () => {
    const findings = [makeFinding('server/src/other.ts', 40, 45)];
    expect(
      scoreSkillEvalCase(
        { kind: 'must_find', file: 'server/src/routes.ts', start_line: 42, end_line: 42 },
        findings,
      ),
    ).toBe(false);
  });

  it('must_not_flag passes when no finding overlaps the expected file+range', () => {
    const findings = [makeFinding('server/src/other.ts', 40, 45)];
    expect(
      scoreSkillEvalCase(
        { kind: 'must_not_flag', file: 'server/src/routes.ts', start_line: 42, end_line: 42 },
        findings,
      ),
    ).toBe(true);
  });

  it('must_not_flag fails when a finding overlaps the expected file+range', () => {
    const findings = [makeFinding('server/src/routes.ts', 40, 45)];
    expect(
      scoreSkillEvalCase(
        { kind: 'must_not_flag', file: 'server/src/routes.ts', start_line: 42, end_line: 42 },
        findings,
      ),
    ).toBe(false);
  });
});
