import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WhyTimeline } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { WhyService } from './service.js';

/**
 * why module (SPEC-04) — the git-why blame drawer.
 *
 *   GET /pulls/:id/why?file&line  → WhyTimeline for that file/line
 *
 * Workspace scope enforced via getContext() + WhyService.loadPull(), same
 * pattern as the brief module. No POST/generate route — this feature is a
 * pure read/compose over git data + already-generated Briefs, no LLM call.
 */

const WhyQuery = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive(),
});

export default async function whyRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new WhyService(container);

  app.get(
    '/pulls/:id/why',
    { schema: { params: IdParams, querystring: WhyQuery } },
    async (req): Promise<WhyTimeline> => {
      const { workspaceId } = await getContext(container, req);
      const { file, line } = req.query;
      return service.getTimeline(workspaceId, req.params.id, file, line);
    },
  );
}
