import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module.
 *   GET    /skills              → list (workspace-scoped)
 *   GET    /skills/:id          → one skill
 *   POST   /skills              → create (manual)
 *   PUT    /skills/:id          → full update (body change bumps version)
 *   PATCH  /skills/:id          → toggle enabled only
 *   DELETE /skills/:id          → delete
 *   POST   /skills/import       → preview parsed markdown WITHOUT saving
 *   POST   /skills/import/save  → save previewed skill (source: imported_url | community)
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
});

const ToggleSkillBody = z.object({
  enabled: z.boolean(),
});

/** Preview request — raw markdown body + optional metadata hint from the client. */
const ImportPreviewBody = z.object({
  /** Raw markdown content pasted or fetched from a file/URL. */
  body: z.string().min(1),
  /** Optional name hint from the filename or URL. Derived from first heading if omitted. */
  name: z.string().optional(),
});

/** Save-after-preview — same fields as create but source is restricted. */
const ImportSaveBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType,
  body: z.string().min(1),
  source: z.enum(['imported_url', 'community']),
});

/** Extract the first markdown heading as a name fallback. */
function extractHeading(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

/** Crude token estimate: ~4 chars per token (GPT rule of thumb). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sanitize imported markdown: strip HTML script/style tags and any blocks that
 * look like executable code (fenced blocks with shell/python/js/ts/bash).
 * The skill body is treated as DATA in prompts (INJECTION_GUARD applies), but
 * we strip executable-looking content at ingest so imported skills can't run
 * code even if somehow evaluated outside of prompt context.
 */
function sanitizeImportedBody(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // /skills/import and /skills/import/save must be registered BEFORE /skills/:id
  // so Fastify does not treat "import" as a uuid param.

  app.post('/skills/import', { schema: { body: ImportPreviewBody } }, async (req) => {
    const { body, name } = req.body;
    const sanitized = sanitizeImportedBody(body);
    const derivedName = name?.trim() || extractHeading(sanitized) || 'Imported skill';
    return {
      name: derivedName,
      body_preview: sanitized,
      token_count: estimateTokens(sanitized),
    };
  });

  app.post('/skills/import/save', { schema: { body: ImportSaveBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const { name, description, type, body, source } = req.body;
    // Imported skills start disabled — must be vetted before enabling.
    const skill = await service.create(workspaceId, {
      name,
      description,
      type,
      body: sanitizeImportedBody(body),
      source,
      enabled: false,
    });
    reply.status(201);
    return skill;
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const { name, description, type, body, source, enabled } = req.body;
    const skill = await service.create(workspaceId, { name, description, type, body, source, enabled });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.patch(
    '/skills/:id',
    { schema: { params: IdParams, body: ToggleSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.toggle(workspaceId, req.params.id, req.body.enabled);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const deleted = await service.delete(workspaceId, req.params.id);
    if (!deleted) throw new NotFoundError('Skill not found');
    reply.status(204);
  });
}
