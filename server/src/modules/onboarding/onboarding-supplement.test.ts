/**
 * onboarding-supplement.test.ts
 *
 * Independent supplement to onboarding.test.ts covering gaps discovered during
 * a spec-first pass. Each test derives its assertion from the literal AC text,
 * not from what the implementation currently does.
 *
 * Coverage added here (not duplicated from the existing 31-test suite):
 *   AC-8  — fillPrompt preserves topRankedFiles in the exact rank order
 *            provided by repo-intel (no re-sorting by the prompt builder)
 *   AC-8  — collectFacts passes topRankedFiles through from getTopFilesByRank
 *            without re-sorting (rank-order preservation end-to-end)
 *   AC-3  — tour object passed to upsert equals the object returned to the
 *            caller; generatedAt returned to the caller is the DB timestamp
 *   AC-7  — calling generateTour a second time (regenerate) still calls upsert
 *            (no short-circuit; overwrite semantics guaranteed at service level)
 *   AC-4  — skeleton sections returned by service have empty link arrays,
 *            non-empty titles, and non-empty bodies (service-level assertion)
 */

// Test intentions:
// 1. fillPrompt (AC-8 rank order)
//    - happy path: topRankedFiles ['src/z_handler.ts','src/a_core.ts','src/m_routes.ts']
//      (non-alphabetical: z beats a beats m by PageRank score) → user message contains them
//      in exactly that order (positional check, not just presence)
//    - boundary: empty topRankedFiles → "Top-ranked files" heading absent from user message
//    - mocks needed: none (fillPrompt is a pure function)
//
// 2. collectFacts (AC-8 rank pass-through)
//    - happy path: getTopFilesByRank returns ['src/z.ts','src/a.ts','src/m.ts'] →
//      result.topRankedFiles is ['src/z.ts','src/a.ts','src/m.ts'] (order preserved, not sorted)
//    - mocks needed: node:fs/promises (readFile → ENOENT, readdir → []), inline RepoIntel mock
//
// 3. OnboardingService.generateTour (AC-3: exact upsert shape + DB timestamp)
//    - happy path: tour object passed to upsert deep-equals the tour returned to caller;
//      result.generatedAt equals the value the upsert mock resolved with (DB-originated)
//    - mocks needed: OnboardingRepository, RepoIntelService, feature-models, fs/promises, LLM
//
// 4. OnboardingService.generateTour (AC-7: regenerate calls upsert again)
//    - happy path: calling generateTour twice causes upsert to be called twice
//      (no "already exists" short-circuit; UPSERT overwrites at DB level)
//    - mocks needed: same as AC-3
//
// 5. OnboardingService.generateTour (AC-4: degraded skeleton links at service level)
//    - happy path: result.tour.sections all have links: [], non-empty title, non-empty body
//    - mocks needed: OnboardingRepository, RepoIntelService (degraded), fs/promises

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { RepoIntel, IndexState } from '../repo-intel/types.js';
import type { Onboarding, OnboardingSection } from '@devdigest/shared';
import { ONBOARDING_SECTIONS } from './types.js';

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be before dynamic imports)
// ============================================================================

vi.mock('./repository.js', () => {
  const OnboardingRepository = vi.fn();
  OnboardingRepository.prototype.findByRepoId = vi.fn();
  OnboardingRepository.prototype.upsert = vi.fn();
  OnboardingRepository.prototype.getClonePath = vi.fn();
  return { OnboardingRepository };
});

vi.mock('../repo-intel/service.js', () => {
  const RepoIntelService = vi.fn();
  RepoIntelService.prototype.getIndexState = vi.fn();
  RepoIntelService.prototype.getTopFilesByRank = vi.fn();
  RepoIntelService.prototype.getCriticalPaths = vi.fn();
  return { RepoIntelService };
});

vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn().mockResolvedValue({ provider: 'openrouter', model: 'test-model' }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn(), readdir: vi.fn() };
});

// ============================================================================
// Imports after mocks
// ============================================================================

import { fillPrompt, collectFacts } from './helpers.js';
import { OnboardingRepository } from './repository.js';
import { RepoIntelService } from '../repo-intel/service.js';
import { OnboardingService } from './service.js';
import * as fsPromises from 'node:fs/promises';

// ============================================================================
// Shared fixtures
// ============================================================================

const VALID_SECTIONS: OnboardingSection[] = ONBOARDING_SECTIONS.map(({ kind, title }) => ({
  kind,
  title,
  body: `Body for ${title}`,
  diagram: null,
  links: [],
}));

const VALID_TOUR: Onboarding = { sections: VALID_SECTIONS };

const MOCK_REPO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_CLONE_PATH = '/tmp/clone/test-repo';
const MOCK_DATE = new Date('2025-01-01T00:00:00.000Z');

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function buildMockContainer(opts: { llmFixture?: Onboarding } = {}) {
  const mockLlm = {
    id: 'openrouter' as const,
    calls: [] as { method: string; req: unknown }[],
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockRejectedValue(new Error('use completeStructured')),
    completeStructured: vi.fn().mockImplementation(
      async (req: { schema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } } }) => {
        const fixture = opts.llmFixture ?? VALID_TOUR;
        const parsed = req.schema.safeParse(fixture);
        if (!parsed.success) throw new Error('Fixture failed schema');
        return { data: parsed.data, model: 'test-model', tokensIn: 100, tokensOut: 50, costUsd: 0.001 };
      },
    ),
  };

  return {
    db: {} as never,
    llm: vi.fn().mockResolvedValue(mockLlm),
    config: {
      repoIntelEnabled: true,
      secretsPath: '',
      cloneDir: '',
      port: 3001,
      host: '0.0.0.0',
      nodeEnv: 'test' as const,
      databaseUrl: '',
      embeddingsEnabled: false,
    },
    secrets: { get: vi.fn() },
    auth: { currentUser: vi.fn(), currentWorkspace: vi.fn() },
    jobs: { enqueue: vi.fn() } as never,
    runBus: {} as never,
    _mockLlm: mockLlm,
  };
}

// ============================================================================
// AC-8 — fillPrompt: rank order preservation
// ============================================================================

describe('helpers: fillPrompt — AC-8 rank order preservation', () => {
  /**
   * The ranked file list is deliberately non-alphabetical (z > a > m by PageRank score).
   * If fillPrompt sorted the list, the order would change to a, m, z.
   * The test checks positional indices to assert the original rank order is preserved.
   */
  it('injects topRankedFiles into the user message in the EXACT rank order (not alphabetically)', () => {
    const rankedInPageRankOrder = [
      'src/z_handler.ts', // highest rank
      'src/a_core.ts',    // second
      'src/m_routes.ts',  // third
    ];

    const bundle: Omit<import('./types.js').FactsBundle, 'indexStatus'> = {
      runtimeName: null,
      frameworkNames: [],
      runScripts: {},
      engines: {},
      topLevelDeps: {},
      directoryTree: '',
      allDiscoveredFiles: [],
      topRankedFiles: rankedInPageRankOrder,
      criticalPaths: [],
      routeList: [],
    };

    const { user } = fillPrompt('{{sections}} {{language}}', bundle);

    const indexZ = user.indexOf('src/z_handler.ts');
    const indexA = user.indexOf('src/a_core.ts');
    const indexM = user.indexOf('src/m_routes.ts');

    // All three files must appear in the prompt
    expect(indexZ).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexM).toBeGreaterThanOrEqual(0);

    // z appears before a (not alphabetical where a < m < z)
    expect(indexZ).toBeLessThan(indexA);
    // a appears before m
    expect(indexA).toBeLessThan(indexM);
  });

  it('omits the "Top-ranked files" section entirely when topRankedFiles is empty', () => {
    const bundle: Omit<import('./types.js').FactsBundle, 'indexStatus'> = {
      runtimeName: null,
      frameworkNames: [],
      runScripts: {},
      engines: {},
      topLevelDeps: {},
      directoryTree: '',
      allDiscoveredFiles: [],
      topRankedFiles: [],
      criticalPaths: [],
      routeList: [],
    };

    const { user } = fillPrompt('{{sections}} {{language}}', bundle);

    expect(user).not.toContain('Top-ranked files by PageRank');
  });
});

// ============================================================================
// AC-8 — collectFacts: rank order pass-through from repo-intel
// ============================================================================

describe('helpers: collectFacts — AC-8 rank order pass-through', () => {
  const mockRepoIntel: RepoIntel = {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn(),
    getBlastRadius: vi.fn(),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns topRankedFiles in the same order getTopFilesByRank provided (no re-sorting)', async () => {
    // Deliberately non-alphabetical: z scores highest, then a, then m
    const nonAlphabeticalRankOrder = ['src/z_entry.ts', 'src/a_core.ts', 'src/m_utils.ts'];

    // package.json missing — simplest possible file system
    (fsPromises.readFile as Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fsPromises.readdir as Mock).mockResolvedValue([]);

    (mockRepoIntel.getTopFilesByRank as Mock).mockResolvedValue(nonAlphabeticalRankOrder);
    (mockRepoIntel.getCriticalPaths as Mock).mockResolvedValue([]);

    const result = await collectFacts({
      repoId: MOCK_REPO_ID,
      clonePath: MOCK_CLONE_PATH,
      repoIntelSvc: mockRepoIntel,
    });

    // The order from repo-intel must be preserved verbatim — no sort applied
    expect(result.topRankedFiles).toEqual(nonAlphabeticalRankOrder);
  });

  it('calls getTopFilesByRank with the correct repoId and top-N limit', async () => {
    (fsPromises.readFile as Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fsPromises.readdir as Mock).mockResolvedValue([]);
    (mockRepoIntel.getTopFilesByRank as Mock).mockResolvedValue([]);
    (mockRepoIntel.getCriticalPaths as Mock).mockResolvedValue([]);

    await collectFacts({
      repoId: MOCK_REPO_ID,
      clonePath: MOCK_CLONE_PATH,
      repoIntelSvc: mockRepoIntel,
    });

    // AC-8: "derive this ranking solely from the repo-intel module's existing ranked-file data"
    // — meaning exactly one call to getTopFilesByRank with the repo id
    expect(mockRepoIntel.getTopFilesByRank).toHaveBeenCalledTimes(1);
    expect(mockRepoIntel.getTopFilesByRank).toHaveBeenCalledWith(MOCK_REPO_ID, expect.any(Number));
  });
});

// ============================================================================
// AC-3 — generateTour: upsert shape + DB-originated generatedAt
// ============================================================================

describe('OnboardingService: generateTour — AC-3 upsert shape and generatedAt', () => {
  let repoMock: {
    findByRepoId: Mock;
    upsert: Mock;
    getClonePath: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    repoMock = {
      findByRepoId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(MOCK_DATE),
      getClonePath: vi.fn().mockResolvedValue(MOCK_CLONE_PATH),
    };
    (OnboardingRepository.prototype.findByRepoId as Mock) = repoMock.findByRepoId;
    (OnboardingRepository.prototype.upsert as Mock) = repoMock.upsert;
    (OnboardingRepository.prototype.getClonePath as Mock) = repoMock.getClonePath;

    (RepoIntelService.prototype.getIndexState as Mock) = vi
      .fn()
      .mockResolvedValue({ status: 'full' } as IndexState);
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockImplementation((filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('onboarding.system.md')) {
        return Promise.resolve('System prompt {{sections}} {{language}}');
      }
      return Promise.resolve(JSON.stringify({ scripts: { start: 'node index.js' } }));
    });
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('passes the exact same tour object to upsert as is returned to the caller', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    // upsert must have been called with repoId and the tour
    expect(repoMock.upsert).toHaveBeenCalledTimes(1);
    const [repoIdArg, tourArg] = repoMock.upsert.mock.calls[0] as [string, Onboarding];

    expect(repoIdArg).toBe(MOCK_REPO_ID);
    // AC-3: "persist the full tour" — the persisted object must match what is returned
    expect(tourArg).toEqual(result.tour);
  });

  it('returns generatedAt from the upsert call (DB-originated timestamp, not an independent new Date())', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    // The service must use the timestamp returned by upsert (MOCK_DATE),
    // not create its own timestamp independently.
    expect(result.generatedAt).toEqual(MOCK_DATE);
  });
});

// ============================================================================
// AC-7 — generateTour: regenerate always calls upsert (no short-circuit)
// ============================================================================

describe('OnboardingService: generateTour — AC-7 regeneration calls upsert each time', () => {
  let repoMock: {
    findByRepoId: Mock;
    upsert: Mock;
    getClonePath: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    repoMock = {
      findByRepoId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(MOCK_DATE),
      getClonePath: vi.fn().mockResolvedValue(MOCK_CLONE_PATH),
    };
    (OnboardingRepository.prototype.findByRepoId as Mock) = repoMock.findByRepoId;
    (OnboardingRepository.prototype.upsert as Mock) = repoMock.upsert;
    (OnboardingRepository.prototype.getClonePath as Mock) = repoMock.getClonePath;

    (RepoIntelService.prototype.getIndexState as Mock) = vi
      .fn()
      .mockResolvedValue({ status: 'full' } as IndexState);
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockImplementation((filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('onboarding.system.md')) {
        return Promise.resolve('System prompt {{sections}} {{language}}');
      }
      return Promise.resolve(JSON.stringify({ scripts: {} }));
    });
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('calls upsert on initial generation AND on regeneration (no "already exists" short-circuit)', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    // Initial generation
    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    expect(repoMock.upsert).toHaveBeenCalledTimes(1);

    // Regeneration — must call upsert again, overwriting the prior entry
    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    expect(repoMock.upsert).toHaveBeenCalledTimes(2);
  });

  it('regeneration upserts with repoId each time (second write uses the same repoId as the first)', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    const firstUpsertRepoId = (repoMock.upsert.mock.calls[0] as [string, unknown])[0];
    const secondUpsertRepoId = (repoMock.upsert.mock.calls[1] as [string, unknown])[0];

    expect(firstUpsertRepoId).toBe(MOCK_REPO_ID);
    expect(secondUpsertRepoId).toBe(MOCK_REPO_ID);
  });
});

// ============================================================================
// AC-4 — generateTour degraded path: service-level link array assertion
// ============================================================================

describe('OnboardingService: generateTour — AC-4 degraded skeleton link arrays (service level)', () => {
  const degradedState: IndexState = {
    status: 'degraded',
    degradedReason: 'index_failed',
    repoId: MOCK_REPO_ID,
    filesIndexed: 0,
    filesSkipped: 0,
    durationMs: 0,
    lastIndexedSha: '',
    indexerVersion: 1,
    updatedAt: MOCK_DATE,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (OnboardingRepository.prototype.getClonePath as Mock) = vi
      .fn()
      .mockResolvedValue(MOCK_CLONE_PATH);
    (OnboardingRepository.prototype.upsert as Mock) = vi.fn().mockResolvedValue(MOCK_DATE);
    (OnboardingRepository.prototype.findByRepoId as Mock) = vi.fn().mockResolvedValue(null);

    (RepoIntelService.prototype.getIndexState as Mock) = vi.fn().mockResolvedValue(degradedState);
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockResolvedValue(JSON.stringify({}));
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('returns all 5 skeleton sections with empty link arrays, non-empty titles, and non-empty bodies', async () => {
    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    expect(result.degraded).toBe(true);
    expect(result.tour.sections).toHaveLength(5);

    for (const section of result.tour.sections) {
      // AC-4: "(c) all link arrays are empty"
      expect(section.links).toEqual([]);
      // AC-4: "5 sections with non-empty titles and non-empty bodies"
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it('does not invoke the LLM on the degraded path (verified at service level)', async () => {
    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    // container.llm is never called — no LLM request is made
    expect(container.llm).not.toHaveBeenCalled();
  });
});
