import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { LLMProvider } from '@devdigest/shared';
import { Onboarding } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ConfigError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoIntelService } from '../repo-intel/service.js';
import { OnboardingRepository } from './repository.js';
import { collectFacts, buildSkeleton, fillPrompt, validateAndStripLinks } from './helpers.js';
import { ONBOARDING_SECTIONS } from './types.js';

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export class OnboardingService {
  constructor(private container: Container) {}

  /**
   * Returns the cached tour for a repo, or null if none has been generated yet.
   * Throws NotFoundError when the repo doesn't belong to the workspace.
   */
  async getTour(
    workspaceId: string,
    repoId: string,
    logger: Logger,
  ): Promise<(Onboarding & { generatedAt: Date }) | null> {
    const repo = new OnboardingRepository(this.container.db);

    // Security scoping: ensure the repo belongs to this workspace
    const clonePath = await repo.getClonePath(repoId, workspaceId);
    if (clonePath === null) {
      throw new NotFoundError('Repository not found');
    }

    const stored = await repo.findByRepoId(repoId);
    if (stored === null) return null;

    const parsed = Onboarding.safeParse(stored.json);
    if (!parsed.success) {
      // Corrupt stored row — treat as "no tour" so the client shows the Generate CTA
      // and the next generation overwrites the row.
      logger.warn({ repoId }, 'stored onboarding json is corrupt; treating as no tour');
      return null;
    }

    return { ...parsed.data, generatedAt: stored.generatedAt };
  }

  /**
   * Generates (or regenerates) the onboarding tour for a repo.
   * Returns the tour, whether it is degraded, and the persistence timestamp.
   */
  async generateTour(
    workspaceId: string,
    repoId: string,
    logger: Logger,
  ): Promise<{ tour: Onboarding; degraded: boolean; generatedAt: Date }> {
    const repo = new OnboardingRepository(this.container.db);

    // Security scoping: ensure the repo belongs to this workspace
    const clonePath = await repo.getClonePath(repoId, workspaceId);
    if (clonePath === null) {
      throw new NotFoundError('Repository not found');
    }

    const riSvc = new RepoIntelService(this.container);
    const state = await riSvc.getIndexState(repoId);
    const bundle = await collectFacts({ repoId, clonePath, repoIntelSvc: riSvc });

    // --- Skeleton path: degraded or failed index ---
    if (state.status === 'degraded' || state.status === 'failed') {
      logger.info(
        { repoId, degradedReason: state.degradedReason },
        'onboarding: generating skeleton (degraded index)',
      );
      const skeleton = buildSkeleton(bundle);
      const generatedAt = await repo.upsert(repoId, skeleton);
      return { tour: skeleton, degraded: true, generatedAt };
    }

    // --- Full path: full or partial index ---
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');

    let llm: LLMProvider;
    try {
      llm = await this.container.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError || (err as { code?: string }).code === 'config_error') {
        throw new AppError(
          'no_llm_key',
          'No model key is configured for the Onboarding Tour feature. Add your API key in Settings → API Keys.',
          503,
        );
      }
      throw err;
    }

    const promptPath = fileURLToPath(
      new URL('../../prompts/onboarding.system.md', import.meta.url),
    );
    const template = await fs.readFile(promptPath, 'utf-8');
    const { system, user } = fillPrompt(template, bundle);

    const result = await llm.completeStructured({
      model,
      schemaName: 'Onboarding',
      schema: Onboarding,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 8192,
      temperature: 0,
    });

    // Zod's z.string() kind field will NOT reject wrong kinds — assert explicitly.
    const expectedKinds = ONBOARDING_SECTIONS.map((s) => s.kind);
    const actualKinds = result.data.sections.map((s) => s.kind);
    if (actualKinds.length !== 5 || !expectedKinds.every((k, i) => k === actualKinds[i])) {
      throw new AppError(
        'invalid_tour_output',
        'LLM returned sections with wrong kind values or count',
        422,
      );
    }

    const knownPaths = new Set(bundle.allDiscoveredFiles);
    const tour: Onboarding = {
      sections: validateAndStripLinks(result.data.sections, knownPaths),
    };

    logger.info({ repoId, costUsd: result.costUsd }, 'onboarding tour generated');

    const generatedAt = await repo.upsert(repoId, tour);
    return { tour, degraded: false, generatedAt };
  }
}
