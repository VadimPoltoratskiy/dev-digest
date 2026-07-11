import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GeneratedEvalCase } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';

vi.mock('./repository.js', () => {
  const SkillsRepository = vi.fn();
  SkillsRepository.prototype.getById = vi.fn();
  return { SkillsRepository };
});

vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn().mockResolvedValue({ provider: 'anthropic', model: 'test-model' }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn().mockResolvedValue('{{mode_instructions}}') };
});

import { SkillsRepository } from './repository.js';
import { SkillsService } from './service.js';

const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_SKILL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const MOCK_SKILL_ROW = {
  id: MOCK_SKILL_ID,
  workspaceId: MOCK_WORKSPACE_ID,
  name: 'No hardcoded secrets',
  description: 'Flags hardcoded credentials.',
  type: 'security' as const,
  source: 'manual' as const,
  body: 'Never commit API keys as string literals.',
  enabled: true,
  version: 1,
  evidenceFiles: null,
  contextDocs: [],
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
};

const VALID_DRAFT: GeneratedEvalCase = {
  name: 'Hardcoded Stripe key',
  notes: null,
  input_diff: '--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,2 @@\n+  stripeKey: "sk_test_FAKE123",',
  expected_finding_count: 1,
  category: 'security',
  severity: 'CRITICAL',
  kind: null,
  file: null,
  start_line: null,
  end_line: null,
  title: null,
};

function buildMockContainer(opts: { llmFixture?: GeneratedEvalCase; llmError?: unknown } = {}) {
  const mockLlm = {
    id: 'anthropic' as const,
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockRejectedValue(new Error('use completeStructured')),
    completeStructured: vi.fn().mockImplementation(
      async (req: { schema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } } }) => {
        const fixture = opts.llmFixture ?? VALID_DRAFT;
        const parsed = req.schema.safeParse(fixture);
        if (!parsed.success) throw new Error('Fixture failed schema');
        return { data: parsed.data, model: 'test-model', tokensIn: 100, tokensOut: 50, costUsd: 0.001 };
      },
    ),
  };

  return {
    db: {} as never,
    llm: opts.llmError ? vi.fn().mockRejectedValue(opts.llmError) : vi.fn().mockResolvedValue(mockLlm),
  };
}

describe('SkillsService.generateEvalCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (SkillsRepository.prototype.getById as Mock) = vi.fn().mockResolvedValue(MOCK_SKILL_ROW);
  });

  it('returns the LLM-drafted case without writing to the repository', async () => {
    const container = buildMockContainer();
    const service = new SkillsService(container as never);

    const result = await service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'count' });

    expect(result).toEqual(VALID_DRAFT);
    // generateEvalCase must never persist — only createEvalCase/updateEvalCase write.
    expect(container.llm).toHaveBeenCalledWith('anthropic');
  });

  it('throws NotFoundError when the skill does not belong to the workspace', async () => {
    (SkillsRepository.prototype.getById as Mock) = vi.fn().mockResolvedValue(undefined);
    const container = buildMockContainer();
    const service = new SkillsService(container as never);

    await expect(service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'count' })).rejects.toThrow(
      'Skill not found',
    );
  });

  it('maps a ConfigError from container.llm to a 503 no_llm_key AppError', async () => {
    const container = buildMockContainer({ llmError: new ConfigError('missing key') });
    const service = new SkillsService(container as never);

    await expect(service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'count' })).rejects.toMatchObject(
      { code: 'no_llm_key', statusCode: 503 },
    );
  });

  it('throws a 422 invalid_generation AppError when the diff has no @@ hunk marker', async () => {
    const container = buildMockContainer({ llmFixture: { ...VALID_DRAFT, input_diff: 'not a diff' } });
    const service = new SkillsService(container as never);

    await expect(service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'count' })).rejects.toMatchObject(
      { code: 'invalid_generation', statusCode: 422 },
    );
  });

  it('throws a 422 invalid_generation AppError for must_find mode missing file/line fields', async () => {
    const container = buildMockContainer({
      llmFixture: { ...VALID_DRAFT, kind: 'must_find', file: null, start_line: null, end_line: null },
    });
    const service = new SkillsService(container as never);

    await expect(
      service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'must_find' }),
    ).rejects.toMatchObject({ code: 'invalid_generation', statusCode: 422 });
  });

  it('propagates a non-config error from container.llm unchanged', async () => {
    const container = buildMockContainer({ llmError: new Error('network down') });
    const service = new SkillsService(container as never);

    await expect(service.generateEvalCase(MOCK_WORKSPACE_ID, MOCK_SKILL_ID, { kindMode: 'count' })).rejects.toThrow(
      'network down',
    );
  });
});
