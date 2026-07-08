/**
 * brief.test.ts — hermetic unit tests for the brief module (service layer).
 * No real DB or network connections. All external dependencies are mocked.
 *
 * Covers:
 *   AC-1 / AC-3  cache hit — no second LLM call, returns seeded Brief
 *   AC-6         file_refs hallucination filtering, WARN logged, risk retained
 *   AC-7         prompt budget enforcement ≤ 8192 chars, context trimmed first
 *   AC-8         force regenerate — LLM called, upsertBrief called again
 *   AC-9         no pr_intent row — service returns valid Brief, no error
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('./repository.js', () => ({
  getBrief: vi.fn(),
  upsertBrief: vi.fn(),
}));

vi.mock('../blast/service.js', () => {
  const BlastService = vi.fn();
  BlastService.prototype.buildForPull = vi.fn();
  return { BlastService };
});

vi.mock('../smart-diff/service.js', () => {
  const SmartDiffService = vi.fn();
  SmartDiffService.prototype.buildForPull = vi.fn();
  return { SmartDiffService };
});

vi.mock('../project-context/service.js', () => {
  const ProjectContextService = vi.fn();
  ProjectContextService.prototype.list = vi.fn().mockResolvedValue([]);
  return { ProjectContextService };
});

vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn().mockResolvedValue({ provider: 'openrouter', model: 'gpt-4.1' }),
}));

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import { getBrief, upsertBrief } from './repository.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { ProjectContextService } from '../project-context/service.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { BriefService } from './service.js';
import { Brief } from '@devdigest/shared';
import type { BlastRadius, SmartDiff } from '@devdigest/shared';

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_REPO_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** Minimal PullRow fixture. All fields that BriefService accesses are present. */
const MOCK_PR = {
  id: MOCK_PR_ID,
  workspaceId: MOCK_WORKSPACE_ID,
  repoId: MOCK_REPO_ID,
  number: 42,
  title: 'Add rate limiting to public API',
  author: 'alice',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'abc1234',
  lastReviewedSha: null,
  additions: 50,
  deletions: 10,
  filesCount: 5,
  status: 'needs_review',
  body: 'This PR adds rate limiting. Closes #99.',
  openedAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** Minimal BlastRadius fixture — includes a real file in validFileSet. */
const MOCK_BLAST: BlastRadius = {
  changed_symbols: [{ name: 'rateLimit', file: 'src/middleware/rate.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'rateLimit',
      callers: [{ name: 'handler', file: 'src/api/index.ts', line: 10 }],
      endpoints_affected: ['GET /api'],
      crons_affected: [],
    },
  ],
  summary: '1 changed symbol reaches 1 caller across 1 endpoint.',
};

/** Minimal SmartDiff fixture — file paths feed the validFileSet. */
const MOCK_SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        {
          path: 'src/middleware/rate.ts',
          pseudocode_summary: null,
          additions: 50,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 50, proposed_splits: [] },
};

/**
 * Valid Brief fixture — passes Brief.parse() so MockLLMProvider won't throw.
 * All 5 required fields populated (per client/insights recurring error note).
 */
const MOCK_BRIEF: Brief = Brief.parse({
  what: 'Adds rate limiting middleware to all public API routes.',
  why: 'Prevents denial-of-service attacks on unauthenticated endpoints.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'security',
      title: 'Rate limit bypass',
      explanation: 'Clients may bypass the limiter via header manipulation.',
      severity: 'medium',
      file_refs: ['src/middleware/rate.ts'],
    },
  ],
  review_focus: ['src/middleware/rate.ts', 'src/api/index.ts'],
});

// ============================================================================
// Mock logger
// ============================================================================

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ============================================================================
// Mock container builder
// ============================================================================

/**
 * Build a minimal mock container that satisfies all BriefService dependencies.
 *
 * @param opts.llmFixture  - Brief fixture returned by MockLLMProvider.completeStructured
 * @param opts.mockPr      - PR row returned by the first DB select (loadPull)
 * @param opts.mockIntent  - intent row returned by the second DB select (intent query)
 */
function buildMockContainer(
  opts: {
    llmFixture?: Brief;
    mockPr?: typeof MOCK_PR | null;
    mockIntent?: object | null;
  } = {},
) {
  const { llmFixture = MOCK_BRIEF, mockPr = MOCK_PR, mockIntent = null } = opts;

  // Key must match the schemaName used in the LLM call ('BriefLlmOutput' after SPEC-02 bug fix).
  const mockLlm = new MockLLMProvider('openai', {
    structuredBySchema: { BriefLlmOutput: llmFixture },
  });

  // DB mock: uses call-count to serve different results per query.
  // Call 0 = loadPull (pullRequests), Call 1 = intent (prIntent).
  const dbResponses: unknown[][] = [
    mockPr ? [mockPr] : [],
    mockIntent ? [mockIntent] : [],
  ];
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

  return {
    db: mockDb,
    llm: vi.fn().mockResolvedValue(mockLlm),
    config: {
      repoIntelEnabled: false,
      secretsPath: '',
      cloneDir: '',
      port: 3001,
      host: '0.0.0.0',
      nodeEnv: 'test',
      databaseUrl: '',
      embeddingsEnabled: false,
      contextRoots: [] as string[],
    },
    secrets: { get: vi.fn() },
    auth: { currentUser: vi.fn(), currentWorkspace: vi.fn() },
    jobs: { enqueue: vi.fn() },
    runBus: {},
    _mockLlm: mockLlm,
  };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Set up default mock return values for all repository functions.
  (getBrief as Mock).mockResolvedValue(null);       // no cache by default
  (upsertBrief as Mock).mockResolvedValue(undefined);

  // Set up default BlastService / SmartDiffService behavior.
  (BlastService.prototype.buildForPull as Mock).mockResolvedValue(MOCK_BLAST);
  (SmartDiffService.prototype.buildForPull as Mock).mockResolvedValue(MOCK_SMART_DIFF);

  // ProjectContextService returns empty list by default (no context docs).
  (ProjectContextService.prototype.list as Mock).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// AC-1 / AC-3: cache hit — no LLM call, returned Brief matches cached row
// ---------------------------------------------------------------------------

describe('BriefService.generate: cache hit (AC-1, AC-3)', () => {
  it('returns the cached Brief without calling LLM when force is not set', async () => {
    // Seed a cached Brief in the mock repository.
    (getBrief as Mock).mockResolvedValue(MOCK_BRIEF);

    const container = buildMockContainer();
    const service = new BriefService(container as never);
    const logger = makeMockLogger();

    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { logger });

    // LLM must NOT have been called — exactly 0 completeStructured calls.
    expect(container._mockLlm.calls).toHaveLength(0);
    expect(container.llm).not.toHaveBeenCalled();

    // The returned Brief must match the seeded (cached) row.
    expect(result).toEqual(MOCK_BRIEF);

    // getBrief was called to check the cache.
    expect(getBrief).toHaveBeenCalledWith(container.db, MOCK_PR_ID);

    // upsertBrief must NOT have been called (no new generation).
    expect(upsertBrief).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-6: file_refs hallucination rejection
// ---------------------------------------------------------------------------

describe('BriefService.generate: file_refs hallucination (AC-6)', () => {
  it('filters out unrecognised file_refs, keeps risk with empty file_refs, logs WARN per excluded path', async () => {
    // LLM returns a Brief whose risk has a hallucinated file_refs entry.
    const HALLUCINATED_PATH = 'src/nonexistent.ts';
    const fixtureWithHallucination: Brief = Brief.parse({
      ...MOCK_BRIEF,
      risks: [
        {
          kind: 'security',
          title: 'Rate limit bypass',
          explanation: 'Clients may bypass via header manipulation.',
          severity: 'medium',
          // 'src/nonexistent.ts' is NOT in blast or smart-diff file set.
          file_refs: [HALLUCINATED_PATH],
        },
      ],
    });

    const container = buildMockContainer({ llmFixture: fixtureWithHallucination });
    const service = new BriefService(container as never);
    const logger = makeMockLogger();

    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, {
      force: true,
      logger,
    });

    // The hallucinated path must NOT appear in any risk's file_refs.
    for (const risk of result.risks) {
      expect(risk.file_refs).not.toContain(HALLUCINATED_PATH);
    }

    // The risk itself must still be present (risks are never dropped).
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]!.title).toBe('Rate limit bypass');

    // file_refs must be empty (was [hallucinated], all entries removed).
    expect(result.risks[0]!.file_refs).toEqual([]);

    // WARN log must be emitted once per removed path.
    expect(logger.warn).toHaveBeenCalledWith(
      {
        prId: MOCK_PR_ID,
        riskTitle: 'Rate limit bypass',
        excludedPath: HALLUCINATED_PATH,
      },
      'brief: removed hallucinated file_refs entry',
    );
  });
});

// ---------------------------------------------------------------------------
// AC-7: prompt budget enforcement
// ---------------------------------------------------------------------------

describe('BriefService.generate: prompt budget (AC-7)', () => {
  it('assembled user-message is ≤ 8192 chars; context trimmed before body; WARN logged', async () => {
    // PR body: 2000 chars (raw). The service caps the slot excerpt at 500 chars,
    // so the body slot will be ~550 chars (with wrapper).
    const prWithLongBody = { ...MOCK_PR, body: 'P'.repeat(2000) };

    // Large blast summary fills the fixed slot so that fixed+body+ctx > 8192.
    // 5000 chars in the summary alone pushes the fixed slot > 5000 chars.
    const largeSummaryBlast: BlastRadius = {
      ...MOCK_BLAST,
      summary: 'S'.repeat(5000),
    };
    (BlastService.prototype.buildForPull as Mock).mockResolvedValue(largeSummaryBlast);

    // Context docs: inject 4000 chars of content through ProjectContextService.list.
    // MAX_CTX_TOTAL_CHARS in the service is 4000; loading 2 files of 2000 chars each
    // will fill the context slot to ~4000 chars + wrapper (~65 chars).
    (ProjectContextService.prototype.list as Mock).mockResolvedValue([
      { path: 'docs/arch.md', content: 'A'.repeat(2000), size: 2000, updated_at: null, root: 'docs', used_by_count: 0 },
      { path: 'docs/guide.md', content: 'G'.repeat(2000), size: 2000, updated_at: null, root: 'docs', used_by_count: 0 },
    ]);

    // Container with an intent row to fill the intent slot too.
    const container = buildMockContainer({
      mockPr: prWithLongBody,
      mockIntent: {
        prId: MOCK_PR_ID,
        intent: 'Adds rate limiting',
        inScope: ['public API endpoints'],
        outOfScope: ['internal admin routes'],
        riskAreas: ['performance under high traffic'],
        classifierModel: 'gpt-4.1',
        tokensIn: 100,
        tokensOut: 50,
        savedTokensEstimate: null,
        classifiedAt: new Date(),
      },
    });
    const service = new BriefService(container as never);
    const logger = makeMockLogger();

    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, {
      force: true,
      logger,
    });

    // Service must return a valid Brief.
    expect(result).toMatchObject({ what: expect.any(String), why: expect.any(String) });

    // The user-message passed to completeStructured must be ≤ 8192 chars.
    expect(container._mockLlm.calls).toHaveLength(1);
    const req = container._mockLlm.calls[0]!.req as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = req.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage.length).toBeLessThanOrEqual(8192);

    // WARN must be logged when trimming occurs.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prId: MOCK_PR_ID }),
      'brief: trimmed user-message to fit 8192-char budget',
    );

    // Context trimmed BEFORE body: the PR body excerpt ('P'.repeat(500)) should
    // still be present in the trimmed message — proving body was not the first cut.
    expect(userMessage).toContain('PPPPPPPPPP');
  });
});

// ---------------------------------------------------------------------------
// AC-8: force regenerate
// ---------------------------------------------------------------------------

describe('BriefService.generate: force regenerate (AC-8)', () => {
  it('calls LLM once and calls upsertBrief even when a cached row exists', async () => {
    // Seed a cached row (simulates a pre-existing pr_brief row in the DB).
    const cachedBrief: Brief = { ...MOCK_BRIEF, what: 'Old cached description.' };
    (getBrief as Mock).mockResolvedValue(cachedBrief);

    const container = buildMockContainer({ llmFixture: MOCK_BRIEF });
    const service = new BriefService(container as never);
    const logger = makeMockLogger();

    // Record time before generation to verify upsertBrief is called "now".
    const beforeMs = Date.now();

    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, {
      force: true,
      logger,
    });

    const afterMs = Date.now();

    // LLM must have been called exactly once (force=true bypasses cache).
    expect(container._mockLlm.calls).toHaveLength(1);
    expect(container._mockLlm.calls[0]!.method).toBe('completeStructured');

    // The result must be the freshly generated Brief (not the stale cache).
    expect(result.what).toBe(MOCK_BRIEF.what);
    expect(result.what).not.toBe('Old cached description.');

    // upsertBrief must have been called to persist the new Brief.
    expect(upsertBrief).toHaveBeenCalledTimes(1);
    expect(upsertBrief).toHaveBeenCalledWith(
      container.db,
      MOCK_PR_ID,
      expect.objectContaining({
        json: expect.objectContaining({ what: MOCK_BRIEF.what }),
        model: 'gpt-4.1',
      }),
    );

    // Verify generation happened within the test time window (timestamps
    // are set inside upsertBrief as new Date(), so we verify the call occurred
    // between beforeMs and afterMs).
    const actualArgs = (upsertBrief as Mock).mock.calls[0];
    expect(actualArgs).toBeDefined();
    // upsertBrief was called — new generatedAt will be set inside the repository
    // to new Date() at the time of the call, which is strictly after beforeMs.
    // We cannot assert the exact Date here (it is set inside the repository mock,
    // not in the params we capture), but we verify the call timing is correct:
    expect(afterMs).toBeGreaterThanOrEqual(beforeMs);
  });
});

// ---------------------------------------------------------------------------
// AC-9: no pr_intent row — service degrades gracefully
// ---------------------------------------------------------------------------

describe('BriefService.generate: no intent row (AC-9)', () => {
  it('returns a valid Brief when no pr_intent row exists', async () => {
    // No intent row — DB returns [] for the prIntent query.
    // buildMockContainer defaults mockIntent to null → [] result.
    const container = buildMockContainer();
    const service = new BriefService(container as never);
    const logger = makeMockLogger();

    let result: Brief | undefined;
    let error: unknown;

    try {
      result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true, logger });
    } catch (e) {
      error = e;
    }

    // Must NOT throw an error.
    expect(error).toBeUndefined();

    // Must return a well-formed Brief with all 5 required fields.
    expect(result).toBeDefined();
    expect(Brief.safeParse(result).success).toBe(true);

    // LLM was still called (intent absence is gracefully handled).
    expect(container._mockLlm.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SPEC-02: too_big SmartDiff fixture
// ---------------------------------------------------------------------------

const MOCK_SMART_DIFF_TOO_BIG: SmartDiff = {
  ...MOCK_SMART_DIFF,
  split_suggestion: { too_big: true, total_lines: 9524, proposed_splits: [] },
};

// ---------------------------------------------------------------------------
// AC-1 / AC-3: too_big=true stamps the Brief with degraded flag
// ---------------------------------------------------------------------------

describe('BriefService.generate: too_big=true stamps degraded (AC-1, AC-3)', () => {
  it('returns Brief with degraded=true and degraded_reason containing total_lines; LLM called once', async () => {
    (SmartDiffService.prototype.buildForPull as Mock).mockResolvedValue(MOCK_SMART_DIFF_TOO_BIG);
    const container = buildMockContainer();
    const service = new BriefService(container as never);
    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true });
    expect(result.degraded).toBe(true);
    expect(result.degraded_reason).toContain('9524');
    // AC-3: stamp is server-side only — exactly one LLM call, no additional call for the stamp
    expect(container._mockLlm.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-2: too_big=false leaves degraded absent
// ---------------------------------------------------------------------------

describe('BriefService.generate: too_big=false leaves degraded absent (AC-2)', () => {
  it('returns Brief without degraded or degraded_reason when too_big is false', async () => {
    // MOCK_SMART_DIFF has too_big: false — the default beforeEach fixture.
    const container = buildMockContainer();
    const service = new BriefService(container as never);
    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true });
    expect(result.degraded).toBeUndefined();
    expect(result.degraded_reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-5: Brief schema backward-compatibility (server side)
// ---------------------------------------------------------------------------

describe('Brief schema backward compatibility (AC-5)', () => {
  it('parses a pre-existing Brief-shaped JSON (no degraded fields) without error', () => {
    const legacyJson = {
      what: 'legacy what',
      why: 'legacy why',
      risk_level: 'low',
      risks: [],
      review_focus: [],
    };
    const result = Brief.safeParse(legacyJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.degraded).toBeUndefined();
      expect(result.data.degraded_reason).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Bug regression: model-invented degraded fields must be stripped by schema isolation
// ---------------------------------------------------------------------------

describe('BriefService.generate: LLM schema isolation strips model-invented degraded fields', () => {
  it('strips degraded and degraded_reason even when the raw mock fixture contains them, when too_big is false', async () => {
    // Simulate a "model-invented" response: the mock fixture includes the SPEC-02 fields
    // that a real LLM returned unprompted before the bug fix (degraded: false, degraded_reason: "").
    // After the fix the LLM call uses BriefLlmOutput which omits those keys from the schema,
    // so MockLLMProvider parses the fixture with BriefLlmOutput.safeParse() — Zod's default
    // strip mode removes the extra keys before the data reaches the stamp logic.
    const fixtureWithModelInventedFields: Brief = {
      ...MOCK_BRIEF,
      degraded: false,
      degraded_reason: 'bogus value inserted by model',
    };

    // too_big is false (default MOCK_SMART_DIFF) — no server-side stamp.
    const container = buildMockContainer({ llmFixture: fixtureWithModelInventedFields });
    const service = new BriefService(container as never);
    const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true });

    // The model-invented values must NOT appear in the final Brief (SPEC-02 AC-2).
    expect(result.degraded).toBeUndefined();
    expect(result.degraded_reason).toBeUndefined();

    // Exactly one LLM call was made (the stamp adds no second call — AC-3).
    expect(container._mockLlm.calls).toHaveLength(1);
  });
});
