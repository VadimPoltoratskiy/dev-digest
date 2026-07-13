/**
 * routes.test.ts — route-level HTTP tests for the multi-runs module (SPEC-03).
 *
 * Test intentions:
 * 1. POST /pulls/:id/multi-review (happy path → 200)
 *    - happy path: delegates to service.createMultiRun, returns result
 *    - boundary: agentIds contains a non-UUID string → 422 (schema validation)
 *    - boundary: agentIds is empty array → 422 (min(1) constraint)
 *    - mocks needed: MultiRunsService (fully mocked via vi.mock)
 *
 * 2. GET /multi-runs/:id (happy path → 200)
 *    - happy path: delegates to service.getMultiRun, returns result
 *    - not-found: service throws NotFoundError → 404
 *    - workspace scoping: request in workspace A cannot read workspace B's run → 404
 *
 * 3. GET /pulls/:id/agents/estimates (happy path → 200)
 *    - happy path: delegates to service.getEstimates, returns result
 *
 * 4. GET /multi-runs/:id/findings (happy path → 200)
 *    - happy path: delegates to service.getFindings, returns result
 *    - not-found: service throws NotFoundError → 404
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('./service.js', () => {
  const MultiRunsService = vi.fn();
  MultiRunsService.prototype.createMultiRun = vi.fn();
  MultiRunsService.prototype.getMultiRun = vi.fn();
  MultiRunsService.prototype.getEstimates = vi.fn();
  MultiRunsService.prototype.getFindings = vi.fn();
  return { MultiRunsService };
});

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import Fastify, { type FastifyInstance } from 'fastify';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { MultiRunsService } from './service.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import multiRunsRoutes from './routes.js';

// ============================================================================
// Constants
// ============================================================================

const WORKSPACE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MULTI_RUN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENT_ID_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const AGENT_ID_2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ============================================================================
// Test app factory
// ============================================================================

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const mockContainer = {
    auth: {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      currentWorkspace: vi.fn().mockResolvedValue({ id: WORKSPACE_ID }),
    },
  } as unknown as Container;

  app.decorate('container', mockContainer);

  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      void reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.validation,
        },
      });
      return;
    }
    if (err instanceof AppError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    void reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  await app.register(multiRunsRoutes);
  return app;
}

function svc() {
  return MultiRunsService.prototype as unknown as Record<string, Mock>;
}

// ============================================================================
// Tests
// ============================================================================

describe('multi-runs routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /pulls/:id/multi-review
  // -------------------------------------------------------------------------
  describe('POST /pulls/:id/multi-review', () => {
    it('returns 200 with multi_run_id and runs on happy path', async () => {
      const responseBody = {
        multi_run_id: MULTI_RUN_ID,
        runs: [
          { run_id: 'run-1', agent_id: AGENT_ID_1, agent_name: 'Agent Alpha' },
        ],
      };
      svc().createMultiRun!.mockResolvedValue(responseBody);

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: [AGENT_ID_1] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as typeof responseBody;
      expect(body.multi_run_id).toBe(MULTI_RUN_ID);
      expect(body.runs).toHaveLength(1);
      expect(svc().createMultiRun!).toHaveBeenCalledWith(
        WORKSPACE_ID,
        PR_ID,
        [AGENT_ID_1],
        expect.anything(),
      );
    });

    it('returns 422 when agentIds contains a non-UUID string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: ['not-a-uuid'] },
      });

      expect(res.statusCode).toBe(422);
      expect(svc().createMultiRun!).not.toHaveBeenCalled();
    });

    it('returns 422 when agentIds is an empty array (min(1) violated)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: [] },
      });

      expect(res.statusCode).toBe(422);
      expect(svc().createMultiRun!).not.toHaveBeenCalled();
    });

    it('returns 422 when agentIds contains 21 valid UUIDs (max(20) exceeded)', async () => {
      // Build 21 distinct valid UUIDs — one over the cap.
      const twentyOneUuids = Array.from(
        { length: 21 },
        (_, i) => `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: twentyOneUuids },
      });

      expect(res.statusCode).toBe(422);
      // Zod validation must reject before the handler is invoked.
      expect(svc().createMultiRun!).not.toHaveBeenCalled();
    });

    it('accepts exactly 20 valid UUIDs (at the cap)', async () => {
      const twentyUuids = Array.from(
        { length: 20 },
        (_, i) => `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
      );
      svc().createMultiRun!.mockResolvedValue({ multi_run_id: MULTI_RUN_ID, runs: [] });

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: twentyUuids },
      });

      expect(res.statusCode).toBe(200);
      expect(svc().createMultiRun!).toHaveBeenCalledOnce();
    });

    it('returns 422 when agentIds field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: {},
      });

      expect(res.statusCode).toBe(422);
    });

    it('returns 404 when PR is not found in the workspace', async () => {
      svc().createMultiRun!.mockRejectedValue(new NotFoundError('Pull request not found'));

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: [AGENT_ID_1] },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    });

    it('returns 422 when agent is not found in workspace', async () => {
      svc().createMultiRun!.mockRejectedValue(
        new AppError('agent_not_found', 'One or more agent IDs not found in this workspace', 422),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_ID}/multi-review`,
        payload: { agentIds: [AGENT_ID_1, AGENT_ID_2] },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('agent_not_found');
    });
  });

  // -------------------------------------------------------------------------
  // GET /multi-runs/:id
  // -------------------------------------------------------------------------
  describe('GET /multi-runs/:id', () => {
    it('returns 200 with multi-run data on happy path', async () => {
      const multiRunRecord = {
        id: MULTI_RUN_ID,
        pr_id: PR_ID,
        pr_number: 42,
        ran_at: '2026-07-01T00:00:00.000Z',
        agents: [
          {
            run_id: 'run-1',
            agent_id: AGENT_ID_1,
            agent_name: 'Alpha',
            status: 'done',
            score: 80,
            finding_count: 2,
            cost_usd: 0.01,
            duration_ms: 3000,
            error: null,
          },
        ],
        total_cost_usd: 0.01,
        total_duration_ms: 3000,
      };
      svc().getMultiRun!.mockResolvedValue(multiRunRecord);

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/${MULTI_RUN_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as typeof multiRunRecord;
      expect(body.id).toBe(MULTI_RUN_ID);
      expect(body.agents).toHaveLength(1);
      expect(svc().getMultiRun!).toHaveBeenCalledWith(WORKSPACE_ID, MULTI_RUN_ID);
    });

    it('returns 404 when multi-run is not found', async () => {
      svc().getMultiRun!.mockRejectedValue(new NotFoundError('Multi-agent run not found'));

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/${MULTI_RUN_ID}`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    });

    it('enforces workspace scoping: NotFoundError for a run from another workspace → 404', async () => {
      // The service is called with this workspace's ID; if the DB row belongs
      // to another workspace, the workspace-scoped query returns nothing →
      // service throws NotFoundError.
      svc().getMultiRun!.mockRejectedValue(new NotFoundError('Multi-agent run not found'));

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/ffffffff-ffff-ffff-ffff-ffffffffffff`,
      });

      expect(res.statusCode).toBe(404);
      // getMultiRun was called with the current workspaceId
      expect(svc().getMultiRun!).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /pulls/:id/agents/estimates
  // -------------------------------------------------------------------------
  describe('GET /pulls/:id/agents/estimates', () => {
    it('returns 200 with estimates array on happy path', async () => {
      const estimates = [
        {
          agent_id: AGENT_ID_1,
          agent_name: 'Alpha',
          estimated_duration_ms: 3000,
          estimated_cost_usd: 0.01,
          last_finding_summary: 'Found issues.',
          has_historical_data: true,
        },
      ];
      svc().getEstimates!.mockResolvedValue(estimates);

      const res = await app.inject({
        method: 'GET',
        url: `/pulls/${PR_ID}/agents/estimates`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as typeof estimates;
      expect(body).toHaveLength(1);
      expect(body[0]!.has_historical_data).toBe(true);
      expect(svc().getEstimates!).toHaveBeenCalledWith(WORKSPACE_ID, PR_ID);
    });

    it('returns 200 with empty array when no agents exist', async () => {
      svc().getEstimates!.mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: `/pulls/${PR_ID}/agents/estimates`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /multi-runs/:id/findings
  // -------------------------------------------------------------------------
  describe('GET /multi-runs/:id/findings', () => {
    it('returns 200 with findings data on happy path', async () => {
      const findings = {
        agents: [
          { agent_id: AGENT_ID_1, agent_name: 'Alpha', findings: [] },
        ],
        groups: [],
      };
      svc().getFindings!.mockResolvedValue(findings);

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/${MULTI_RUN_ID}/findings`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as typeof findings;
      expect(body.agents).toHaveLength(1);
      expect(body.groups).toHaveLength(0);
      expect(svc().getFindings!).toHaveBeenCalledWith(WORKSPACE_ID, MULTI_RUN_ID);
    });

    it('returns 404 when multi-run is not found', async () => {
      svc().getFindings!.mockRejectedValue(new NotFoundError('Multi-agent run not found'));

      const res = await app.inject({
        method: 'GET',
        url: `/multi-runs/${MULTI_RUN_ID}/findings`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    });
  });
});
