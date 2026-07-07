import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding module — generates and retrieves per-repo newcomer tours.
 *
 *   GET  /repos/:repoId/onboarding  → fetch cached tour (404 if none yet)
 *   POST /repos/:repoId/onboarding  → generate (or regenerate) the tour
 *
 * `z.string().uuid()` on the repoId param causes fastify-type-provider-zod to
 * reject invalid UUIDs with 422 before the handler runs.
 */

const RepoIdParams = z.object({ repoId: z.string().uuid() });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container);

  /**
   * GET /repos/:repoId/onboarding
   * Returns the cached onboarding tour, or 404 if none has been generated.
   */
  app.get(
    '/repos/:repoId/onboarding',
    { schema: { params: RepoIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.getTour(workspaceId, req.params.repoId, req.log);
      if (result === null) {
        return reply.status(404).send({
          error: { code: 'not_found', message: 'No tour generated for this repository yet' },
        });
      }
      return { ...result, generatedAt: result.generatedAt.toISOString() };
    },
  );

  /**
   * POST /repos/:repoId/onboarding
   * Generates (or regenerates) the onboarding tour for the given repo.
   * Returns 503 with code 'no_llm_key' when no API key is configured.
   */
  app.post(
    '/repos/:repoId/onboarding',
    { schema: { params: RepoIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { tour, degraded, generatedAt } = await service.generateTour(
        workspaceId,
        req.params.repoId,
        req.log,
      );
      return {
        ...tour,
        generatedAt: generatedAt.toISOString(),
        ...(degraded ? { degraded: true } : {}),
      };
    },
  );
}
