import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { EvalsService } from './service.js';

/**
 * Evals module — global dashboard.
 *   GET /evals/dashboard   → EvalDashboard (workspace-scoped, optional owner_id filter)
 */

const DashboardQuery = z.object({
  owner_id: z.string().uuid().optional(),
});

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  app.get(
    '/evals/dashboard',
    { schema: { querystring: DashboardQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDashboard(workspaceId, req.query.owner_id);
    },
  );
}
