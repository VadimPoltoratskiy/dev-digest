import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BlastExplanation, BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET  /pulls/:id/blast              → BlastRadius for a PR (from pr_files).
 *   POST /repos/:id/blast              → BlastRadius for an explicit file list (MCP).
 *   GET  /pulls/:id/blast/explanation  → cached AI explanation, or null.
 *   POST /pulls/:id/blast/explain      → generate the AI explanation (ONE cheap
 *                                        LLM call), persist, and return it.
 *
 * The map routes read the ready-made repo-intel index — no model call. The
 * explain route is the feature's only token consumer, and only on demand.
 */
const BlastRepoBody = z.object({ files: z.array(z.string()) });

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      return service.buildForPull(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/blast',
    { schema: { params: IdParams, body: BlastRepoBody } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      return service.buildForRepo(workspaceId, req.params.id, req.body.files);
    },
  );

  app.get(
    '/pulls/:id/blast/explanation',
    { schema: { params: IdParams } },
    async (req): Promise<BlastExplanation | null> => {
      const { workspaceId } = await getContext(container, req);
      return service.getExplanation(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/blast/explain',
    { schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req): Promise<BlastExplanation> => {
      const { workspaceId } = await getContext(container, req);
      return service.explainBlast(workspaceId, req.params.id, { logger: req.log });
    },
  );
}
