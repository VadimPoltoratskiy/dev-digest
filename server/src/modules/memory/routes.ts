/**
 * Memory module routes — Fastify plugin.
 *   GET    /memory                → list (with optional scope/kind/freshness/q filters)
 *   POST   /memory                → create a new memory record (201)
 *   GET    /memory/export         → JSONL export (MUST be registered before /memory/:id)
 *   PATCH  /memory/:id            → partial update
 *   DELETE /memory/:id            → delete (204)
 *
 * IMPORTANT: GET /memory/export is registered BEFORE GET /memory/:id so Fastify
 * does not interpret the literal "export" path segment as an id param value.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MemoryItem, MemoryKind, MemoryScope, MemorySource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MemoryService } from './service.js';

// ---- Request schemas --------------------------------------------------------

const MemoryQuerySchema = z.object({
  scope: MemoryScope.optional(),
  kind: MemoryKind.optional(),
  repo: z.string().optional(),
  freshness: z.literal('stale').optional(),
  q: z.string().optional(),
});

const CreateMemoryBody = MemoryItem.extend({
  /** Optional repo id to scope this record to a specific repository. */
  repo: z.string().optional(),
});

const UpdateMemoryBody = z.object({
  content: z.string().optional(),
  scope: MemoryScope.optional(),
  kind: MemoryKind.optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(MemorySource).optional(),
});

const ExportQuerySchema = z.object({
  repo: z.string().optional(),
});

// ---- Plugin -----------------------------------------------------------------

export default async function memoryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MemoryService(app.container);

  // ---- GET /memory -----------------------------------------------------------
  app.get(
    '/memory',
    { schema: { querystring: MemoryQuerySchema } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.query);
    },
  );

  // ---- POST /memory ----------------------------------------------------------
  app.post(
    '/memory',
    { schema: { body: CreateMemoryBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { repo, ...memoryItem } = req.body;
      const record = await service.create(workspaceId, { ...memoryItem, repoId: repo });
      reply.status(201);
      return record;
    },
  );

  // ---- GET /memory/export ----------------------------------------------------
  // Registered BEFORE /memory/:id to prevent Fastify treating "export" as an id.
  app.get(
    '/memory/export',
    { schema: { querystring: ExportQuerySchema } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const jsonl = await service.exportJsonl(workspaceId, req.query.repo);
      reply.header('content-type', 'application/x-ndjson');
      return reply.send(jsonl);
    },
  );

  // ---- PATCH /memory/:id -----------------------------------------------------
  app.patch(
    '/memory/:id',
    { schema: { params: IdParams, body: UpdateMemoryBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Memory record not found');
      return updated;
    },
  );

  // ---- DELETE /memory/:id ----------------------------------------------------
  app.delete(
    '/memory/:id',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const deleted = await service.delete(workspaceId, req.params.id);
      if (!deleted) throw new NotFoundError('Memory record not found');
      reply.status(204);
    },
  );
}
