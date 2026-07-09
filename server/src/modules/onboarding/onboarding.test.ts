/**
 * onboarding.test.ts — hermetic unit tests for the onboarding module.
 * No DB or network connections.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { IndexState, RepoIntel } from '../repo-intel/types.js';
import type { Onboarding, OnboardingSection } from '@devdigest/shared';
import { ONBOARDING_SECTIONS } from './types.js';
import {
  collectFacts,
  buildSkeleton,
  fillPrompt,
  validateAndStripLinks,
} from './helpers.js';

// ============================================================================
// Module-level mocks (must be at top level for vi.mock hoisting)
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
// Helpers: import after mocks
// ============================================================================

import { OnboardingRepository } from './repository.js';
import { RepoIntelService } from '../repo-intel/service.js';
import { ConfigError, AppError, NotFoundError } from '../../platform/errors.js';
import { OnboardingService } from './service.js';
import * as fsPromises from 'node:fs/promises';

// ============================================================================
// Fixtures
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

// Minimal mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Build a minimal mock container
function buildMockContainer(opts: {
  llmFixture?: Onboarding;
  llmShouldThrow?: Error;
} = {}) {
  const mockLlm = {
    id: 'openrouter' as const,
    calls: [] as { method: string; req: unknown }[],
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockRejectedValue(new Error('use completeStructured')),
    completeStructured: vi.fn().mockImplementation(async (req: { schema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } } }) => {
      const fixture = opts.llmFixture ?? VALID_TOUR;
      const parsed = req.schema.safeParse(fixture);
      if (!parsed.success) throw new Error('Fixture failed schema');
      return { data: parsed.data, model: 'test-model', tokensIn: 100, tokensOut: 50, costUsd: 0.001 };
    }),
  };

  return {
    db: {} as never,
    llm: opts.llmShouldThrow
      ? vi.fn().mockRejectedValue(opts.llmShouldThrow)
      : vi.fn().mockResolvedValue(mockLlm),
    config: {
      repoIntelEnabled: true,
      secretsPath: '',
      cloneDir: '',
      port: 3001,
      host: '0.0.0.0',
      nodeEnv: 'test',
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
// Helper function unit tests
// ============================================================================

describe('helpers: collectFacts', () => {
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

  it('extracts runScripts, frameworkNames, directoryTree, allDiscoveredFiles from a valid package.json', async () => {
    const pkg = {
      scripts: { start: 'node index.js', test: 'vitest' },
      engines: { node: '>=20' },
      dependencies: { fastify: '^5.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    };

    (fsPromises.readFile as Mock).mockResolvedValueOnce(JSON.stringify(pkg));

    // Mock readdir for directory scan
    (fsPromises.readdir as Mock).mockResolvedValue([
      { name: 'src', isDirectory: () => true, isFile: () => false },
      { name: 'package.json', isDirectory: () => false, isFile: () => true },
    ]);

    (mockRepoIntel.getTopFilesByRank as Mock).mockResolvedValue(['src/index.ts']);
    (mockRepoIntel.getCriticalPaths as Mock).mockResolvedValue([['src/index.ts', 'src/app.ts']]);

    const result = await collectFacts({
      repoId: MOCK_REPO_ID,
      clonePath: MOCK_CLONE_PATH,
      repoIntelSvc: mockRepoIntel,
    });

    expect(result.runScripts).toEqual({ start: 'node index.js', test: 'vitest' });
    expect(result.frameworkNames).toContain('fastify');
    expect(result.engines).toEqual({ node: '>=20' });
    expect(result.runtimeName).toBe('node');
    expect(result.topRankedFiles).toEqual(['src/index.ts']);
    expect(result.criticalPaths).toEqual([['src/index.ts', 'src/app.ts']]);
    expect(result.routeList).toEqual([]);
    // directoryTree and allDiscoveredFiles come from readdir
    expect(result.directoryTree).toContain('package.json');
    expect(result.allDiscoveredFiles).toContain('package.json');
  });

  it('returns empty defaults when package.json is absent, but still populates allDiscoveredFiles', async () => {
    (fsPromises.readFile as Mock).mockRejectedValueOnce(new Error('ENOENT'));

    (fsPromises.readdir as Mock).mockResolvedValue([
      { name: 'README.md', isDirectory: () => false, isFile: () => true },
      { name: '.git', isDirectory: () => true, isFile: () => false },
    ]);

    (mockRepoIntel.getTopFilesByRank as Mock).mockResolvedValue([]);
    (mockRepoIntel.getCriticalPaths as Mock).mockResolvedValue([]);

    const result = await collectFacts({
      repoId: MOCK_REPO_ID,
      clonePath: MOCK_CLONE_PATH,
      repoIntelSvc: mockRepoIntel,
    });

    expect(result.runScripts).toEqual({});
    expect(result.frameworkNames).toEqual([]);
    expect(result.runtimeName).toBeNull();
    // .git is skipped; README.md is found
    expect(result.allDiscoveredFiles).toContain('README.md');
    expect(result.allDiscoveredFiles.some((f) => f.startsWith('.git'))).toBe(false);
  });
});

describe('helpers: buildSkeleton', () => {
  const bundle = {
    runtimeName: 'node' as const,
    frameworkNames: ['fastify'],
    runScripts: { dev: 'tsx watch src/server.ts', test: 'vitest run' },
    engines: { node: '>=20' },
    topLevelDeps: { fastify: '^5.0.0' },
    directoryTree: 'src/\n  server.ts\n  app.ts',
    allDiscoveredFiles: ['src/server.ts', 'src/app.ts'],
    topRankedFiles: ['src/server.ts'],
    criticalPaths: [['src/server.ts', 'src/app.ts']],
    routeList: [],
  };

  it('returns exactly 5 sections in ONBOARDING_SECTIONS order', () => {
    const result = buildSkeleton(bundle);
    expect(result.sections).toHaveLength(5);
    const expectedKinds = ONBOARDING_SECTIONS.map((s) => s.kind);
    expect(result.sections.map((s) => s.kind)).toEqual(expectedKinds);
  });

  it('sets diagram to null on all sections', () => {
    const result = buildSkeleton(bundle);
    result.sections.forEach((s) => expect(s.diagram).toBeNull());
  });

  it('sets links to empty array on all sections', () => {
    const result = buildSkeleton(bundle);
    result.sections.forEach((s) => expect(s.links).toEqual([]));
  });

  it('includes script text in the how_to_run body', () => {
    const result = buildSkeleton(bundle);
    const howToRun = result.sections.find((s) => s.kind === 'how_to_run');
    expect(howToRun?.body).toContain('dev');
    expect(howToRun?.body).toContain('tsx watch src/server.ts');
  });

  it('includes directoryTree in the architecture_overview body', () => {
    const result = buildSkeleton(bundle);
    const arch = result.sections.find((s) => s.kind === 'architecture_overview');
    expect(arch?.body).toContain('src/');
  });
});

describe('helpers: fillPrompt', () => {
  const bundle = {
    runtimeName: 'node' as const,
    frameworkNames: ['fastify'],
    runScripts: { start: 'node index.js' },
    engines: { node: '>=20' },
    topLevelDeps: { fastify: '^5.0.0' },
    directoryTree: 'src/\n  index.ts',
    allDiscoveredFiles: ['src/index.ts'],
    topRankedFiles: ['src/index.ts'],
    criticalPaths: [['src/index.ts', 'src/app.ts']],
    routeList: [],
  };

  const template = `System prompt. Sections: {{sections}}. Language: {{language}}.`;

  it('replaces {{sections}} with all 5 section entries', () => {
    const { system } = fillPrompt(template, bundle);
    ONBOARDING_SECTIONS.forEach(({ kind, title }) => {
      expect(system).toContain(kind);
      expect(system).toContain(title);
    });
  });

  it('replaces {{language}} with English', () => {
    const { system } = fillPrompt(template, bundle);
    expect(system).toContain('English');
    expect(system).not.toContain('{{language}}');
  });

  it('wraps untrusted repo-sourced values in <untrusted> blocks', () => {
    const { user } = fillPrompt(template, bundle);
    expect(user).toContain('<untrusted>');
    expect(user).toContain('</untrusted>');
    // Framework name is untrusted
    expect(user).toContain('fastify');
    // Script content is untrusted
    expect(user).toContain('node index.js');
  });
});

describe('helpers: validateAndStripLinks', () => {
  const knownPaths = new Set(['src/index.ts', 'src/app.ts', 'README.md']);

  it('strips links whose path is NOT in knownPaths', () => {
    const sections: OnboardingSection[] = [
      {
        kind: 'architecture_overview',
        title: 'Architecture',
        body: 'body',
        diagram: null,
        links: [
          { label: 'Valid', path: 'src/index.ts' },
          { label: 'Hallucinated', path: 'src/nonexistent.ts' },
        ],
      },
    ];

    const result = validateAndStripLinks(sections, knownPaths);
    expect(result[0]!.links).toHaveLength(1);
    expect(result[0]!.links[0]!.path).toBe('src/index.ts');
  });

  it('keeps a link whose path is in the full 2-level scan but NOT in topRankedFiles (proves full scan is used)', () => {
    // topRankedFiles would only have the top 20 files — README.md might not be there
    // but it IS in allDiscoveredFiles (the full scan)
    const sections: OnboardingSection[] = [
      {
        kind: 'reading_order',
        title: 'Reading Order',
        body: 'body',
        diagram: null,
        links: [
          { label: 'README', path: 'README.md' }, // in full scan, not in top-ranked
        ],
      },
    ];

    const result = validateAndStripLinks(sections, knownPaths);
    expect(result[0]!.links).toHaveLength(1);
    expect(result[0]!.links[0]!.path).toBe('README.md');
  });

  it('passes through empty links without modification', () => {
    const sections: OnboardingSection[] = [
      { kind: 'how_to_run', title: 'Run', body: 'body', diagram: null, links: [] },
    ];
    const result = validateAndStripLinks(sections, knownPaths);
    expect(result[0]!.links).toEqual([]);
  });
});

// ============================================================================
// Service unit tests
// ============================================================================

describe('OnboardingService: getTour', () => {
  let repoMock: {
    findByRepoId: Mock;
    upsert: Mock;
    getClonePath: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repoMock = {
      findByRepoId: vi.fn(),
      upsert: vi.fn().mockResolvedValue(MOCK_DATE),
      getClonePath: vi.fn().mockResolvedValue(MOCK_CLONE_PATH),
    };
    // Reset OnboardingRepository prototype mocks
    (OnboardingRepository.prototype.findByRepoId as Mock) = repoMock.findByRepoId;
    (OnboardingRepository.prototype.upsert as Mock) = repoMock.upsert;
    (OnboardingRepository.prototype.getClonePath as Mock) = repoMock.getClonePath;
  });

  it('returns null when no stored tour exists', async () => {
    repoMock.findByRepoId.mockResolvedValue(null);

    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    const result = await service.getTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    expect(result).toBeNull();
  });

  it('returns the parsed tour when a valid stored tour exists', async () => {
    repoMock.findByRepoId.mockResolvedValue({ json: VALID_TOUR, generatedAt: MOCK_DATE });

    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    const result = await service.getTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(5);
    expect(result!.generatedAt).toEqual(MOCK_DATE);
  });

  it('returns null (not throws) when stored json is corrupt, and logs a warn', async () => {
    repoMock.findByRepoId.mockResolvedValue({ json: { invalid: 'garbage' }, generatedAt: MOCK_DATE });

    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    // Should NOT throw — enables the client to show the Generate CTA
    const result = await service.getTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);
    expect(result).toBeNull();

    // The corrupt-row path must emit a warn log so operators can detect data corruption
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { repoId: MOCK_REPO_ID },
      'stored onboarding json is corrupt; treating as no tour',
    );
  });

  it('throws NotFoundError when repo does not belong to workspace (cross-tenant prevention)', async () => {
    repoMock.getClonePath.mockResolvedValue(null); // not in this workspace

    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    await expect(
      service.getTour('wrong-workspace', MOCK_REPO_ID, mockLogger),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('OnboardingService: generateTour — happy path (full index)', () => {
  let repoMock: {
    findByRepoId: Mock;
    upsert: Mock;
    getClonePath: Mock;
  };
  let riMock: {
    getIndexState: Mock;
    getTopFilesByRank: Mock;
    getCriticalPaths: Mock;
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

    riMock = {
      getIndexState: vi.fn().mockResolvedValue({ status: 'full' } as IndexState),
      getTopFilesByRank: vi.fn().mockResolvedValue([]),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
    };
    (RepoIntelService.prototype.getIndexState as Mock) = riMock.getIndexState;
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = riMock.getTopFilesByRank;
    (RepoIntelService.prototype.getCriticalPaths as Mock) = riMock.getCriticalPaths;

    // fs mocks
    (fsPromises.readFile as Mock).mockImplementation((filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('onboarding.system.md')) {
        return Promise.resolve('System prompt {{sections}} {{language}}');
      }
      // package.json mock
      return Promise.resolve(JSON.stringify({ scripts: { start: 'node index.js' } }));
    });
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('calls LLM exactly once and returns 5 sections in correct order', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    expect(container._mockLlm.completeStructured).toHaveBeenCalledTimes(1);
    expect(result.tour.sections).toHaveLength(5);
    expect(result.degraded).toBe(false);
  });

  it('returns sections with exactly the expected kind strings in order', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    expect(result.tour.sections.map((s) => s.kind)).toEqual([
      'architecture_overview',
      'critical_paths',
      'how_to_run',
      'reading_order',
      'first_tasks',
    ]);
  });

  it('calls upsert exactly once with the repoId and tour', async () => {
    const container = buildMockContainer({ llmFixture: VALID_TOUR });
    const service = new OnboardingService(container as never);

    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

    expect(repoMock.upsert).toHaveBeenCalledTimes(1);
    expect(repoMock.upsert).toHaveBeenCalledWith(
      MOCK_REPO_ID,
      expect.objectContaining({ sections: expect.any(Array) }),
    );
  });
});

describe('OnboardingService: generateTour — degraded path (all 5 DegradedReason values)', () => {
  let repoMock: {
    upsert: Mock;
    getClonePath: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    repoMock = {
      upsert: vi.fn().mockResolvedValue(MOCK_DATE),
      getClonePath: vi.fn().mockResolvedValue(MOCK_CLONE_PATH),
    };
    (OnboardingRepository.prototype.upsert as Mock) = repoMock.upsert;
    (OnboardingRepository.prototype.getClonePath as Mock) = repoMock.getClonePath;
    (OnboardingRepository.prototype.findByRepoId as Mock) = vi.fn().mockResolvedValue(null);

    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockResolvedValue(JSON.stringify({}));
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  const degradedCases: [string, IndexState][] = [
    ['flag_off', { status: 'degraded', degradedReason: 'flag_off', repoId: MOCK_REPO_ID, filesIndexed: 0, filesSkipped: 0, durationMs: 0, lastIndexedSha: '', indexerVersion: 1, updatedAt: MOCK_DATE }],
    ['index_failed', { status: 'failed', degradedReason: 'index_failed', repoId: MOCK_REPO_ID, filesIndexed: 0, filesSkipped: 0, durationMs: 0, lastIndexedSha: '', indexerVersion: 1, updatedAt: MOCK_DATE }],
    ['index_partial', { status: 'degraded', degradedReason: 'index_partial', repoId: MOCK_REPO_ID, filesIndexed: 0, filesSkipped: 0, durationMs: 0, lastIndexedSha: '', indexerVersion: 1, updatedAt: MOCK_DATE }],
    ['repo_too_large', { status: 'degraded', degradedReason: 'repo_too_large', repoId: MOCK_REPO_ID, filesIndexed: 0, filesSkipped: 0, durationMs: 0, lastIndexedSha: '', indexerVersion: 1, updatedAt: MOCK_DATE }],
    ['no_data (synthesised by getIndexState when no row exists)', { status: 'degraded', degradedReason: 'no_data', repoId: MOCK_REPO_ID, filesIndexed: 0, filesSkipped: 0, durationMs: 0, lastIndexedSha: '', indexerVersion: 1, updatedAt: MOCK_DATE }],
  ];

  for (const [name, indexState] of degradedCases) {
    it(`skeleton path with degradedReason=${name}: no LLM call, degraded=true, 5 sections`, async () => {
      (RepoIntelService.prototype.getIndexState as Mock) = vi.fn().mockResolvedValue(indexState);

      const container = buildMockContainer();
      const service = new OnboardingService(container as never);

      const result = await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger);

      // No LLM call should be made
      expect(container.llm).not.toHaveBeenCalled();
      expect(result.degraded).toBe(true);
      expect(result.tour.sections).toHaveLength(5);
      expect(result.generatedAt).toEqual(MOCK_DATE);
    });
  }
});

describe('OnboardingService: generateTour — no-key path (AC-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (OnboardingRepository.prototype.getClonePath as Mock) = vi.fn().mockResolvedValue(MOCK_CLONE_PATH);
    (OnboardingRepository.prototype.upsert as Mock) = vi.fn().mockResolvedValue(MOCK_DATE);
    (OnboardingRepository.prototype.findByRepoId as Mock) = vi.fn().mockResolvedValue(null);

    (RepoIntelService.prototype.getIndexState as Mock) = vi.fn().mockResolvedValue({ status: 'full' } as IndexState);
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockResolvedValue(JSON.stringify({}));
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('throws AppError with code=no_llm_key and statusCode=503 when ConfigError is thrown by container.llm', async () => {
    const container = buildMockContainer({
      llmShouldThrow: new ConfigError('OPENROUTER_API_KEY is not configured'),
    });
    const service = new OnboardingService(container as never);

    const err = await service
      .generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('no_llm_key');
    expect((err as AppError).statusCode).toBe(503);
  });

  it('does NOT call upsert when the no-key error is thrown', async () => {
    const repoUpsert = vi.fn();
    (OnboardingRepository.prototype.upsert as Mock) = repoUpsert;

    const container = buildMockContainer({
      llmShouldThrow: new ConfigError('OPENROUTER_API_KEY is not configured'),
    });
    const service = new OnboardingService(container as never);

    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger).catch(() => {});

    expect(repoUpsert).not.toHaveBeenCalled();
  });
});

describe('OnboardingService: generateTour — invalid LLM output (wrong kind strings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (OnboardingRepository.prototype.getClonePath as Mock) = vi.fn().mockResolvedValue(MOCK_CLONE_PATH);
    (OnboardingRepository.prototype.upsert as Mock) = vi.fn().mockResolvedValue(MOCK_DATE);
    (OnboardingRepository.prototype.findByRepoId as Mock) = vi.fn().mockResolvedValue(null);

    (RepoIntelService.prototype.getIndexState as Mock) = vi.fn().mockResolvedValue({ status: 'full' } as IndexState);
    (RepoIntelService.prototype.getTopFilesByRank as Mock) = vi.fn().mockResolvedValue([]);
    (RepoIntelService.prototype.getCriticalPaths as Mock) = vi.fn().mockResolvedValue([]);

    (fsPromises.readFile as Mock).mockResolvedValue(JSON.stringify({}));
    (fsPromises.readdir as Mock).mockResolvedValue([]);
  });

  it('throws AppError with code=invalid_tour_output when LLM returns wrong kind strings', async () => {
    // Wrong kind values — 'architecture' instead of 'architecture_overview' etc.
    const wrongTour: Onboarding = {
      sections: ONBOARDING_SECTIONS.map(({ title }, i) => ({
        kind: i === 0 ? 'architecture' : `wrong_kind_${i}`, // wrong kinds
        title,
        body: 'body',
        diagram: null,
        links: [],
      })),
    };

    const container = buildMockContainer({ llmFixture: wrongTour });
    const service = new OnboardingService(container as never);

    const err = await service
      .generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('invalid_tour_output');
    expect((err as AppError).statusCode).toBe(422);
  });

  it('does NOT call upsert when LLM output is invalid', async () => {
    const repoUpsert = vi.fn();
    (OnboardingRepository.prototype.upsert as Mock) = repoUpsert;

    const wrongTour: Onboarding = {
      sections: [
        { kind: 'architecture', title: 'Arch', body: 'body', diagram: null, links: [] },
      ],
    };

    const container = buildMockContainer({ llmFixture: wrongTour });
    const service = new OnboardingService(container as never);

    await service.generateTour(MOCK_WORKSPACE_ID, MOCK_REPO_ID, mockLogger).catch(() => {});

    expect(repoUpsert).not.toHaveBeenCalled();
  });
});

describe('OnboardingService: generateTour — cross-tenant access prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (OnboardingRepository.prototype.getClonePath as Mock) = vi.fn().mockResolvedValue(null);
    (OnboardingRepository.prototype.findByRepoId as Mock) = vi.fn().mockResolvedValue(null);
    (OnboardingRepository.prototype.upsert as Mock) = vi.fn().mockResolvedValue(MOCK_DATE);
  });

  it('throws NotFoundError when getClonePath returns null for generateTour', async () => {
    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    await expect(
      service.generateTour('wrong-workspace', MOCK_REPO_ID, mockLogger),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when getClonePath returns null for getTour', async () => {
    const container = buildMockContainer();
    const service = new OnboardingService(container as never);

    await expect(
      service.getTour('wrong-workspace', MOCK_REPO_ID, mockLogger),
    ).rejects.toThrow(NotFoundError);
  });
});
