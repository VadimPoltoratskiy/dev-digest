/**
 * why.test.ts — hermetic unit tests for the why module (WhyService, SPEC-04).
 * No real DB, git, or network connections. All external dependencies mocked.
 *
 * Covers:
 *   AC-1  blame + log walk produces a WhyTimeline with newest-first events
 *   AC-2  parsePrNumber: parenthesised form, bare form, no match
 *   AC-3  enrichment: rationale + file-scoped risks attached when a linked PR
 *         has a generated Brief; absent when no PR/Brief; risks empty but
 *         rationale present when the Brief's risks don't reference this file
 *   AC-4  is_blame_head marking; blame field reuses the matching event
 *   AC-5  workspace-scope guard (404 via NotFoundError)
 *   AC-6  degrade paths: repo not cloned, git blame/log throws, no commits
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../repo-intel/repository.js', () => {
  const RepoIntelRepository = vi.fn();
  RepoIntelRepository.prototype.getRepoBasics = vi.fn();
  return { RepoIntelRepository };
});

vi.mock('../brief/repository.js', () => ({
  getBrief: vi.fn(),
}));

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import { RepoIntelRepository } from '../repo-intel/repository.js';
import { getBrief } from '../brief/repository.js';
import { WhyService, parsePrNumber } from './service.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Brief } from '@devdigest/shared';

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_REPO_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MOCK_LINKED_PR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const FILE = 'src/middleware/rate.ts';

const MOCK_PR = {
  id: MOCK_PR_ID,
  workspaceId: MOCK_WORKSPACE_ID,
  repoId: MOCK_REPO_ID,
  number: 42,
};

const MOCK_REPO_BASICS = {
  id: MOCK_REPO_ID,
  owner: 'acme',
  name: 'payments-api',
  defaultBranch: 'main',
  clonePath: '/clones/acme/payments-api',
};

const MOCK_BRIEF: Brief = {
  what: 'Adds rate limiting middleware.',
  why: 'Prevents abuse of unauthenticated endpoints.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'security',
      title: 'Rate limit bypass',
      explanation: 'Clients may bypass via header manipulation.',
      severity: 'medium',
      file_refs: [FILE],
    },
    {
      kind: 'perf',
      title: 'Unrelated risk',
      explanation: 'Touches a different file.',
      severity: 'low',
      file_refs: ['src/other.ts'],
    },
  ],
  review_focus: [],
};

/** Build a minimal mock container with a call-count-based DB queue. */
function buildMockContainer(opts: {
  mockPr?: typeof MOCK_PR | null;
  dbResponsesAfterPull?: unknown[][];
  blame?: unknown[];
  log?: unknown[];
  gitThrows?: boolean;
} = {}) {
  const { mockPr = MOCK_PR, dbResponsesAfterPull = [], blame = [], log = [], gitThrows = false } = opts;

  const dbResponses: unknown[][] = [mockPr ? [mockPr] : [], ...dbResponsesAfterPull];
  let dbCallCount = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          const idx = dbCallCount++;
          return Promise.resolve(dbResponses[idx] ?? []);
        }),
      })),
    })),
  };

  const gitBlame = gitThrows
    ? vi.fn().mockRejectedValue(new Error('git blame failed'))
    : vi.fn().mockResolvedValue(blame);
  const gitLog = gitThrows
    ? vi.fn().mockRejectedValue(new Error('git log failed'))
    : vi.fn().mockResolvedValue(log);

  return {
    db: mockDb,
    git: { blame: gitBlame, log: gitLog },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (RepoIntelRepository.prototype.getRepoBasics as Mock).mockResolvedValue(MOCK_REPO_BASICS);
  (getBrief as Mock).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// AC-2: parsePrNumber
// ---------------------------------------------------------------------------

describe('parsePrNumber', () => {
  it('parses the parenthesised GitHub squash-merge form', () => {
    expect(parsePrNumber('Add rate limiting (#123)')).toBe(123);
  });

  it('falls back to a bare #NNN reference', () => {
    expect(parsePrNumber('Fix bug, closes #45')).toBe(45);
  });

  it('returns null when no PR reference exists', () => {
    expect(parsePrNumber('Just a plain commit message')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-1, AC-4: blame + log walk, is_blame_head marking
// ---------------------------------------------------------------------------

describe('WhyService.getTimeline: blame + log walk (AC-1, AC-4)', () => {
  it('returns events newest-first with is_blame_head set on the matching commit', async () => {
    const container = buildMockContainer({
      blame: [{ line: 10, sha: 'sha-new', author: 'alice', date: '2026-07-01T00:00:00.000Z', summary: 'Newest commit' }],
      log: [
        { sha: 'sha-new', message: 'Newest commit', author: 'alice', date: '2026-07-01T00:00:00.000Z' },
        { sha: 'sha-old', message: 'Older commit', author: 'bob', date: '2026-06-01T00:00:00.000Z' },
      ],
    });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 10);

    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.sha).toBe('sha-new');
    expect(result.events[0]!.is_blame_head).toBe(true);
    expect(result.events[1]!.is_blame_head).toBe(false);
    expect(result.blame).toEqual(result.events[0]);
    expect(result.summary).toContain('alice');
  });
});

// ---------------------------------------------------------------------------
// AC-3: enrichment via linked PR's Brief
// ---------------------------------------------------------------------------

describe('WhyService.getTimeline: Brief enrichment (AC-3)', () => {
  it('attaches rationale + file-scoped risks when the linked PR has a generated Brief', async () => {
    (getBrief as Mock).mockResolvedValue(MOCK_BRIEF);

    const container = buildMockContainer({
      dbResponsesAfterPull: [[{ id: MOCK_LINKED_PR_ID, repoId: MOCK_REPO_ID, number: 7 }]],
      blame: [{ line: 1, sha: 'sha-1', author: 'alice', date: '2026-07-01T00:00:00.000Z', summary: 'Add rate limiting (#7)' }],
      log: [{ sha: 'sha-1', message: 'Add rate limiting (#7)', author: 'alice', date: '2026-07-01T00:00:00.000Z' }],
    });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result.events[0]!.pr_number).toBe(7);
    expect(result.events[0]!.rationale).toBe(MOCK_BRIEF.why);
    // Only the risk whose file_refs includes FILE is kept.
    expect(result.events[0]!.risks).toEqual([MOCK_BRIEF.risks[0]]);
  });

  it('leaves rationale/risks absent when the commit references no PR', async () => {
    const container = buildMockContainer({
      blame: [{ line: 1, sha: 'sha-1', author: 'alice', date: '2026-07-01T00:00:00.000Z', summary: 'Plain commit' }],
      log: [{ sha: 'sha-1', message: 'Plain commit', author: 'alice', date: '2026-07-01T00:00:00.000Z' }],
    });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result.events[0]!.pr_number).toBeNull();
    expect(result.events[0]!.rationale).toBeUndefined();
    expect(result.events[0]!.risks).toBeUndefined();
    expect(getBrief).not.toHaveBeenCalled();
  });

  it('leaves rationale/risks absent when the referenced PR has no generated Brief', async () => {
    (getBrief as Mock).mockResolvedValue(null);

    const container = buildMockContainer({
      dbResponsesAfterPull: [[{ id: MOCK_LINKED_PR_ID, repoId: MOCK_REPO_ID, number: 7 }]],
      blame: [{ line: 1, sha: 'sha-1', author: 'alice', date: '2026-07-01T00:00:00.000Z', summary: 'Add feature (#7)' }],
      log: [{ sha: 'sha-1', message: 'Add feature (#7)', author: 'alice', date: '2026-07-01T00:00:00.000Z' }],
    });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result.events[0]!.rationale).toBeUndefined();
    expect(result.events[0]!.risks).toBeUndefined();
  });

  it('keeps rationale but empties risks when the Brief has no risks referencing this file', async () => {
    (getBrief as Mock).mockResolvedValue(MOCK_BRIEF);

    const container = buildMockContainer({
      dbResponsesAfterPull: [[{ id: MOCK_LINKED_PR_ID, repoId: MOCK_REPO_ID, number: 7 }]],
      blame: [{ line: 1, sha: 'sha-1', author: 'alice', date: '2026-07-01T00:00:00.000Z', summary: 'Add feature (#7)' }],
      log: [{ sha: 'sha-1', message: 'Add feature (#7)', author: 'alice', date: '2026-07-01T00:00:00.000Z' }],
    });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, 'src/unrelated-file.ts', 1);

    expect(result.events[0]!.rationale).toBe(MOCK_BRIEF.why);
    expect(result.events[0]!.risks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-5: workspace-scope guard
// ---------------------------------------------------------------------------

describe('WhyService.getTimeline: workspace-scope guard (AC-5)', () => {
  it('throws NotFoundError when the PR does not belong to the workspace', async () => {
    const container = buildMockContainer({ mockPr: null });
    const service = new WhyService(container as never);

    await expect(
      service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// AC-6: degrade paths
// ---------------------------------------------------------------------------

describe('WhyService.getTimeline: degrade paths (AC-6)', () => {
  it('returns an empty timeline when the repo has not been cloned yet', async () => {
    (RepoIntelRepository.prototype.getRepoBasics as Mock).mockResolvedValue({
      ...MOCK_REPO_BASICS,
      clonePath: null,
    });
    const container = buildMockContainer();
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result).toEqual({ file: FILE, line: 1, blame: null, events: [], summary: expect.any(String) });
    expect(container.git.blame).not.toHaveBeenCalled();
  });

  it('returns an empty timeline when git blame/log fails', async () => {
    const container = buildMockContainer({ gitThrows: true });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result.events).toEqual([]);
    expect(result.blame).toBeNull();
  });

  it('returns an empty timeline when the file has no commit history', async () => {
    const container = buildMockContainer({ blame: [], log: [] });
    const service = new WhyService(container as never);

    const result = await service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1);

    expect(result.events).toEqual([]);
    expect(result.blame).toBeNull();
  });
});
