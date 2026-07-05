import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET  /pulls/:id/blast  → BlastRadius for a PR (files derived from pr_files).
 *   POST /repos/:id/blast  → BlastRadius for an explicit file list (MCP-facing).
 *
 * Both read the ready-made repo-intel index via `container.repoIntel` and map
 * the result to the BlastRadius contract. No model call — deterministic reads.
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
}
