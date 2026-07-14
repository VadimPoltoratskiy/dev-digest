import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiReviewRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiRunsService } from './service.js';

/**
 * multi-runs module.
 *   POST   /pulls/:id/multi-review             → create multi-agent run
 *   GET    /multi-runs/:id                     → multi-run status + agent summaries
 *   GET    /pulls/:id/agents/estimates         → per-agent time/cost estimates
 *   GET    /multi-runs/:id/findings            → grouped cross-agent findings
 *
 * Security:
 *   - `getContext` on every handler enforces workspace scoping before any DB access.
 *   - POST body is Zod-validated; `agentIds` is an array of `.uuid()` strings with
 *     `.min(1)` — invalid UUIDs or empty array rejects 422 before the handler runs.
 *   - The service layer performs workspace membership checks on both the PR and
 *     each agent before any DB write (defense-in-depth per security skill A01).
 */
export default async function multiRunsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiRunsService(container);

  // Querystring schema for GET /multi-runs
  const ListMultiRunsQuery = z.object({
    repoId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  // GET /multi-runs?repoId=&limit=&offset=
  app.get(
    '/multi-runs',
    { schema: { querystring: ListMultiRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listMultiRuns(workspaceId, req.query.repoId, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
    },
  );

  // POST /pulls/:id/multi-review — create multi-agent run
  // Tight rate limit: each call fans out to N expensive LLM reviews.
  app.post(
    '/pulls/:id/multi-review',
    {
      schema: { params: IdParams, body: MultiReviewRequest },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.createMultiRun(
        workspaceId,
        req.params.id,
        req.body.agentIds,
        req.log,
      );
    },
  );

  // GET /multi-runs/:id — multi-run status summary
  app.get(
    '/multi-runs/:id',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getMultiRun(workspaceId, req.params.id);
    },
  );

  // GET /pulls/:id/agents/estimates — per-agent estimates for Configure Run page
  app.get(
    '/pulls/:id/agents/estimates',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getEstimates(workspaceId, req.params.id);
    },
  );

  // GET /multi-runs/:id/findings — grouped cross-agent findings
  app.get(
    '/multi-runs/:id/findings',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getFindings(workspaceId, req.params.id);
    },
  );
}
