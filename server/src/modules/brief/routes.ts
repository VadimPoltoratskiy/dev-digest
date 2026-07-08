import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Brief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module.
 *
 *   GET  /pulls/:id/brief  → return cached Brief, or 404 if none exists (AC-2)
 *   POST /pulls/:id/brief  → generate (or return cached) Brief (AC-1, AC-3, AC-5, AC-8)
 *
 * Both routes enforce workspace scope via getContext() + BriefService.loadPull().
 * Error handling for NotFoundError (404) and ExternalServiceError (502) is done
 * by the global error handler registered in app.ts — no per-route try/catch needed.
 */

const BriefBody = z.object({
  force: z.boolean().optional(),
});

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  /**
   * GET /pulls/:id/brief
   * Returns the cached Brief, or 404 if no brief has been generated for this PR.
   */
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req, reply): Promise<Brief> => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.get(workspaceId, req.params.id);
      if (result === null) {
        return reply.status(404).send({
          error: { code: 'not_found', message: 'No brief for this PR' },
        }) as never;
      }
      return result;
    },
  );

  /**
   * POST /pulls/:id/brief
   * Generate (or regenerate with force: true) the PR brief.
   * Rate-limited to 10 req/min to control LLM spend.
   */
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: BriefBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<Brief> => {
      const { workspaceId } = await getContext(container, req);
      return service.generate(workspaceId, req.params.id, {
        force: req.body.force,
        logger: req.log,
      });
    },
  );
}
