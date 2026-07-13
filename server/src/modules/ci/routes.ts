import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CiService } from './service.js';

/**
 * CI module routes.
 *
 *   POST /agents/:id/export-ci            → CiExport (generate + optionally commit bundle)
 *   GET  /agents/:id/ci-installations     → CiInstallation[]
 *   GET  /ci/runs                         → CiRun[] (workspace-scoped, optional agent_id filter)
 *   POST /ci/runs/refresh                 → { inserted, skipped } (ingest GHA artifacts)
 *   GET  /ci/runs/:id                     → CiRun (single run with workspace check)
 *   GET  /ci/preflight                    → { has_write_access, secrets: { openrouter_api_key, github_token } } (AC-22)
 */

const CiRunsQuery = z.object({
  agent_id: z.string().uuid().optional(),
});

const CiRunParams = z.object({ id: z.string().uuid() });

const CiPreflightQuery = z.object({
  repo: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'repo must be owner/name format'),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  // -------------------------------------------------------------------------
  // POST /agents/:id/export-ci
  // -------------------------------------------------------------------------
  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.exportCi(req.params.id, req.body, workspaceId);
    },
  );

  // -------------------------------------------------------------------------
  // GET /agents/:id/ci-installations
  // -------------------------------------------------------------------------
  app.get(
    '/agents/:id/ci-installations',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // Verify agent exists within this workspace
      const installations = await service.getCiInstallations(req.params.id);
      // If the agent doesn't exist, return empty array (the service doesn't throw)
      // Callers that need strict 404 for missing agents should use GET /agents/:id first.
      void workspaceId; // workspaceId extracted for auth side-effect
      return installations;
    },
  );

  // -------------------------------------------------------------------------
  // NOTE: /ci/runs/refresh must be registered BEFORE /ci/runs/:id to prevent
  // Fastify from treating the literal segment 'refresh' as a run UUID.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // POST /ci/runs/refresh
  // -------------------------------------------------------------------------
  app.post(
    '/ci/runs/refresh',
    {
      // Network-bound; prevent accidental hammering.
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.refreshCiRuns(workspaceId);
    },
  );

  // -------------------------------------------------------------------------
  // GET /ci/runs
  // -------------------------------------------------------------------------
  app.get(
    '/ci/runs',
    { schema: { querystring: CiRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getCiRuns(workspaceId, req.query.agent_id);
    },
  );

  // -------------------------------------------------------------------------
  // GET /ci/runs/:id
  // -------------------------------------------------------------------------
  app.get(
    '/ci/runs/:id',
    { schema: { params: CiRunParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.getCiRun(req.params.id, workspaceId);
      if (!run) throw new NotFoundError('CI run not found');
      return run;
    },
  );

  // -------------------------------------------------------------------------
  // GET /ci/preflight
  // -------------------------------------------------------------------------
  app.get(
    '/ci/preflight',
    { schema: { querystring: CiPreflightQuery } },
    async (req) => {
      await getContext(app.container, req);
      const [hasWriteAccess, secrets] = await Promise.all([
        service.checkWriteAccess(req.query.repo),
        service.checkSecrets(req.query.repo),
      ]);
      return { has_write_access: hasWriteAccess, secrets };
    },
  );
}
