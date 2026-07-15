import { describe, it, expect } from 'vitest';
import { groupFindingsByFileAndOverlap } from './helpers.js';
import type { FindingRecord } from '@devdigest/shared';

/**
 * Unit tests for the pure groupFindingsByFileAndOverlap helper (SPEC-03 Task 1.11).
 *
 * AC-12: same file + overlapping line range → 1 group;
 *        different files + same range → 2 groups;
 *        one agent flags a location the other does not → the non-flagging
 *        agent shows finding = null ("did not flag").
 */

// Minimal factory for a FindingRecord — only fields used by the grouping logic
// (file, start_line, end_line) plus the required fields for the Zod type.
function makeFinding(
  overrides: Partial<FindingRecord> & { file: string; start_line: number; end_line: number },
): FindingRecord {
  return {
    id: overrides.id ?? 'finding-id',
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'Test finding',
    file: overrides.file,
    start_line: overrides.start_line,
    end_line: overrides.end_line,
    rationale: overrides.rationale ?? 'Rationale',
    suggestion: overrides.suggestion ?? null,
    confidence: overrides.confidence ?? 0.9,
    kind: overrides.kind ?? null,
    trifecta_components: overrides.trifecta_components ?? null,
    review_id: overrides.review_id ?? 'review-id',
    accepted_at: overrides.accepted_at ?? null,
    dismissed_at: overrides.dismissed_at ?? null,
  };
}

const agentA = { agentId: 'agent-a', agentName: 'Agent A' };
const agentB = { agentId: 'agent-b', agentName: 'Agent B' };
const allAgents = [agentA, agentB];

describe('groupFindingsByFileAndOverlap', () => {
  it('two findings, same file, overlapping ranges → 1 group spanning union', () => {
    // A: lines 10–20, B: lines 15–25 → overlap → 1 group [10, 25]
    const findingA = makeFinding({ id: 'f1', file: 'foo.ts', start_line: 10, end_line: 20 });
    const findingB = makeFinding({ id: 'f2', file: 'foo.ts', start_line: 15, end_line: 25 });

    const groups = groupFindingsByFileAndOverlap(
      [
        { ...agentA, finding: findingA },
        { ...agentB, finding: findingB },
      ],
      allAgents,
    );

    expect(groups).toHaveLength(1);

    const [group] = groups as [typeof groups[0]]; // safe: we just asserted length 1
    expect(group!.file).toBe('foo.ts');
    expect(group!.start_line).toBe(10);
    expect(group!.end_line).toBe(25);

    // Both agents contributed a finding
    const verdictA = group!.agent_verdicts.find((v) => v.agent_id === agentA.agentId)!;
    const verdictB = group!.agent_verdicts.find((v) => v.agent_id === agentB.agentId)!;
    expect(verdictA.finding).not.toBeNull();
    expect(verdictB.finding).not.toBeNull();
  });

  it('two findings, same file, non-overlapping ranges → 2 groups', () => {
    // A: lines 10–20, B: lines 30–40 → no overlap
    const findingA = makeFinding({ id: 'f1', file: 'foo.ts', start_line: 10, end_line: 20 });
    const findingB = makeFinding({ id: 'f2', file: 'foo.ts', start_line: 30, end_line: 40 });

    const groups = groupFindingsByFileAndOverlap(
      [
        { ...agentA, finding: findingA },
        { ...agentB, finding: findingB },
      ],
      allAgents,
    );

    expect(groups).toHaveLength(2);
    const [g0, g1] = groups as [typeof groups[0], typeof groups[1]];
    expect(g0!.start_line).toBe(10);
    expect(g0!.end_line).toBe(20);
    expect(g1!.start_line).toBe(30);
    expect(g1!.end_line).toBe(40);
  });

  it('two findings, different files, same range → 2 groups', () => {
    const findingA = makeFinding({ id: 'f1', file: 'foo.ts', start_line: 10, end_line: 20 });
    const findingB = makeFinding({ id: 'f2', file: 'bar.ts', start_line: 10, end_line: 20 });

    const groups = groupFindingsByFileAndOverlap(
      [
        { ...agentA, finding: findingA },
        { ...agentB, finding: findingB },
      ],
      allAgents,
    );

    expect(groups).toHaveLength(2);
    const files = groups.map((g) => g.file).sort();
    expect(files).toEqual(['bar.ts', 'foo.ts']);
  });

  it('agent A flags, agent B has no findings → 1 group with B finding = null ("did not flag")', () => {
    // AC-12: a non-flagging agent shows finding = null
    const findingA = makeFinding({ id: 'f1', file: 'foo.ts', start_line: 10, end_line: 20 });

    const groups = groupFindingsByFileAndOverlap(
      [{ ...agentA, finding: findingA }],
      allAgents, // allAgents includes both A and B
    );

    expect(groups).toHaveLength(1);
    const [group] = groups as [typeof groups[0]];
    const verdictA = group!.agent_verdicts.find((v) => v.agent_id === agentA.agentId)!;
    const verdictB = group!.agent_verdicts.find((v) => v.agent_id === agentB.agentId)!;
    expect(verdictA.finding).not.toBeNull();
    expect(verdictB.finding).toBeNull();
  });

  it('same file + same range but different category → 1 group with both findings (no substance filter)', () => {
    // AC-12 edge case 5: no substance/category filter; same location = 1 group
    const findingA = makeFinding({
      id: 'f1',
      file: 'foo.ts',
      start_line: 10,
      end_line: 20,
      category: 'security',
      title: 'Security issue',
    });
    const findingB = makeFinding({
      id: 'f2',
      file: 'foo.ts',
      start_line: 10,
      end_line: 20,
      category: 'style',
      title: 'Style issue',
    });

    const groups = groupFindingsByFileAndOverlap(
      [
        { ...agentA, finding: findingA },
        { ...agentB, finding: findingB },
      ],
      allAgents,
    );

    expect(groups).toHaveLength(1);
    const [group] = groups as [typeof groups[0]];
    expect(group!.start_line).toBe(10);
    expect(group!.end_line).toBe(20);

    const verdictA = group!.agent_verdicts.find((v) => v.agent_id === agentA.agentId)!;
    const verdictB = group!.agent_verdicts.find((v) => v.agent_id === agentB.agentId)!;
    // Both agents' findings are present; the grouper does not filter by substance
    expect(verdictA.finding?.category).toBe('security');
    expect(verdictB.finding?.category).toBe('style');
  });
});
