/**
 * routes.test.ts — route-level HTTP tests for the why module (SPEC-04).
 *
 * Covers:
 *   AC-1  GET /pulls/:id/why?file&line returns 200 with the service's WhyTimeline
 *   AC-5  returns HTTP 404 when the PR belongs to a different workspace
 *   Query validation — missing/invalid file or line → 422
 *
 * The service layer is fully mocked so these tests exercise only the route
 * handler + query-schema validation, not WhyService internals (covered in
 * why.test.ts).
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('./service.js', () => {
  const WhyService = vi.fn();
  WhyService.prototype.getTimeline = vi.fn();
  return { WhyService };
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
import { WhyService } from './service.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import whyRoutes from './routes.js';

const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const mockContainer = {
    auth: {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      currentWorkspace: vi.fn().mockResolvedValue({ id: MOCK_WORKSPACE_ID }),
    },
  } as unknown as Container;

  app.decorate('container', mockContainer);

  app.setErrorHandler((err, _req, reply) => {
    // Mirrors app.ts's validation → 422 mapping, the piece this route's
    // querystring schema actually exercises.
    if (hasZodFastifySchemaValidationErrors(err)) {
      void reply.status(422).send({
        error: { code: 'validation_error', message: 'Request validation failed', details: err.validation },
      });
      return;
    }
    if (err instanceof AppError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    void reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  await app.register(whyRoutes);
  return app;
}

describe('why routes: GET /pulls/:id/why', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns HTTP 200 with the WhyTimeline from the service (AC-1)', async () => {
    const timeline = {
      file: 'src/a.ts',
      line: 10,
      blame: null,
      events: [],
      summary: '0 commits touch this file.',
    };
    (WhyService.prototype.getTimeline as Mock).mockResolvedValue(timeline);

    const response = await app.inject({
      method: 'GET',
      url: `/pulls/${MOCK_PR_ID}/why?file=src%2Fa.ts&line=10`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(timeline);
    expect(WhyService.prototype.getTimeline).toHaveBeenCalledWith(
      MOCK_WORKSPACE_ID,
      MOCK_PR_ID,
      'src/a.ts',
      10,
    );
  });

  it('returns HTTP 404 when the PR belongs to a different workspace (AC-5)', async () => {
    (WhyService.prototype.getTimeline as Mock).mockRejectedValue(
      new NotFoundError('Pull request not found'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/pulls/${MOCK_PR_ID}/why?file=src%2Fa.ts&line=10`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('returns HTTP 422 when file is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/pulls/${MOCK_PR_ID}/why?line=10`,
    });

    expect(response.statusCode).toBe(422);
  });

  it('returns HTTP 422 when line is not a valid positive integer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/pulls/${MOCK_PR_ID}/why?file=src%2Fa.ts&line=not-a-number`,
    });

    expect(response.statusCode).toBe(422);
  });
});
