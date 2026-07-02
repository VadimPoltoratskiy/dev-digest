import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';
import type { ConventionRow } from './repository.js';

function toDto(row: ConventionRow) {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}

/**
 * Conventions module — extracts and manages code-style convention candidates.
 *   GET  /repos/:id/conventions            → list candidates for a repo
 *   POST /repos/:id/conventions/extract    → run LLM extraction; returns updated list
 *   PATCH /conventions/:convId             → accept/reject or edit rule text
 *   DELETE /conventions/:convId            → remove a candidate
 *   POST /repos/:id/conventions/to-skill   → convert accepted candidates to a Skill
 */

const ConvIdParams = z.object({ convId: z.string().uuid() });

const UpdateConventionBody = z.object({
  accepted: z.boolean().optional(),
  rule: z.string().min(1).optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return (await service.list(workspaceId, req.params.id)).map(toDto);
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return (await service.extract(workspaceId, req.params.id)).map(toDto);
  });

  app.post(
    '/repos/:id/conventions/to-skill',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.convertToSkill(workspaceId, req.params.id);
      reply.status(201);
      return skill;
    },
  );

  app.patch(
    '/conventions/:convId',
    { schema: { params: ConvIdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.convId, req.body);
      if (!updated) throw new NotFoundError('Convention candidate not found');
      return toDto(updated);
    },
  );

  app.delete('/conventions/:convId', { schema: { params: ConvIdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const deleted = await service.deleteOne(workspaceId, req.params.convId);
    if (!deleted) throw new NotFoundError('Convention candidate not found');
    reply.status(204);
  });
}
