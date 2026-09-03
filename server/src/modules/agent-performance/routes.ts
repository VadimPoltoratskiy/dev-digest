import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { PeriodParams } from '../_shared/schemas.js';
import { AgentPerformanceService } from './service.js';

/**
 * Agent Performance dashboard module routes.
 *   GET /agent-performance   → workspace-level dashboard (AgentPerformance)
 *
 * 422 is returned automatically by the Zod type provider when PeriodParams
 * validation fails — no manual try-catch needed.
 */
export default async function agentPerformanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentPerformanceService(app.container);

  app.get(
    '/agent-performance',
    { schema: { querystring: PeriodParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDashboard(workspaceId, req.query);
    },
  );
}
