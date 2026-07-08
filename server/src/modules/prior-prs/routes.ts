import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PriorPrList } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PriorPrsService } from './service.js';

const PriorPrsQuery = z.object({
  path: z.string().min(1),
});

export default async function priorPrsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PriorPrsService(container);

  app.get(
    '/pulls/:id/files/prior-prs',
    { schema: { params: IdParams, querystring: PriorPrsQuery } },
    async (req): Promise<PriorPrList> => {
      const { workspaceId } = await getContext(container, req);
      return service.getPriorPrs(workspaceId, req.params.id, req.query.path);
    },
  );
}
