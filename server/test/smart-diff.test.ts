import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/classifier.js';
import { latestBatchFindings } from '../src/modules/smart-diff/findings-batch.js';
import type { ReviewDto, ReviewDtoFinding } from '../src/modules/reviews/helpers.js';

describe('classifyFile', () => {
  it('classifies lock files, dist, and snapshots as boilerplate', () => {
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('server/dist/index.js')).toBe('boilerplate');
    expect(classifyFile('src/__snapshots__/foo.test.ts.snap')).toBe('boilerplate');
  });

  it('classifies configs and wiring entrypoints as wiring', () => {
    expect(classifyFile('src/config.ts')).toBe('wiring');
    expect(classifyFile('src/api/public/index.ts')).toBe('wiring');
    expect(classifyFile('src/server.ts')).toBe('wiring');
    expect(classifyFile('package.json')).toBe('wiring');
  });

  it('defaults everything else to core', () => {
    expect(classifyFile('src/middleware/ratelimit.ts')).toBe('core');
    expect(classifyFile('src/api/public/webhooks.ts')).toBe('core');
  });
});

function finding(overrides: Partial<ReviewDtoFinding> = {}): ReviewDtoFinding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'correctness',
    title: 't',
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    review_id: 'r1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  } as ReviewDtoFinding;
}

function review(overrides: Partial<ReviewDto> = {}): ReviewDto {
  return {
    id: 'r1',
    pr_id: 'pr1',
    agent_id: 'agent1',
    run_id: 'run1',
    agent_name: 'Agent',
    kind: 'review',
    verdict: null,
    summary: null,
    score: null,
    model: null,
    created_at: new Date().toISOString(),
    findings: [],
    ...overrides,
  };
}

describe('latestBatchFindings', () => {
  it('collects findings from multiple agent reviews within the latest batch window', () => {
    const now = Date.now();
    const reviews: ReviewDto[] = [
      review({ id: 'r1', created_at: new Date(now).toISOString(), findings: [finding({ id: 'f1' })] }),
      review({
        id: 'r2',
        created_at: new Date(now - 60_000).toISOString(),
        findings: [finding({ id: 'f2' })],
      }),
    ];
    const findings = latestBatchFindings(reviews);
    expect(findings.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('excludes reviews outside the 5-minute batch window', () => {
    const now = Date.now();
    const reviews: ReviewDto[] = [
      review({ id: 'r1', created_at: new Date(now).toISOString(), findings: [finding({ id: 'f1' })] }),
      review({
        id: 'r2',
        created_at: new Date(now - 10 * 60_000).toISOString(),
        findings: [finding({ id: 'f2' })],
      }),
    ];
    const findings = latestBatchFindings(reviews);
    expect(findings.map((f) => f.id)).toEqual(['f1']);
  });

  it('excludes dismissed findings and non-review kinds', () => {
    const now = Date.now();
    const reviews: ReviewDto[] = [
      review({
        id: 'r1',
        created_at: new Date(now).toISOString(),
        findings: [finding({ id: 'f1', dismissed_at: new Date().toISOString() }), finding({ id: 'f2' })],
      }),
      review({ id: 'r2', kind: 'summary', created_at: new Date(now).toISOString(), findings: [finding({ id: 'f3' })] }),
    ];
    const findings = latestBatchFindings(reviews);
    expect(findings.map((f) => f.id)).toEqual(['f2']);
  });
});
