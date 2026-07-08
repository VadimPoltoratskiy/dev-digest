/**
 * routes.test.ts — route-level HTTP tests for the brief module.
 * Uses Fastify app.inject() to verify HTTP status codes at the route boundary.
 *
 * Covers:
 *   AC-2  GET /pulls/:id/brief returns HTTP 404 when no cached brief row exists
 *   AC-4  POST /pulls/:id/brief returns HTTP 404 when PR belongs to a different workspace
 *
 * The service layer is fully mocked so these tests exercise only the
 * route handler logic and the global AppError → HTTP status mapping —
 * not the BriefService internals (those are covered in brief.test.ts).
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('./service.js', () => {
  const BriefService = vi.fn();
  BriefService.prototype.get = vi.fn();
  BriefService.prototype.generate = vi.fn();
  return { BriefService };
});

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { BriefService } from './service.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import briefRoutes from './routes.js';

// ============================================================================
// Constants
// ============================================================================

const MOCK_WORKSPACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MOCK_PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ============================================================================
// Test app factory
// ============================================================================

/**
 * Build a minimal Fastify app that registers briefRoutes with the Zod type
 * provider and the same AppError → HTTP status mapping as the production app.
 *
 * BriefService is fully mocked — the mock container only needs `auth` for
 * getContext() to resolve the workspace id.  All other Container properties
 * are irrelevant since BriefService.prototype.get / .generate are intercepted
 * before they reach any real adapter or DB.
 */
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Minimal container: only `auth` is accessed in the route boundary
  // via getContext() → container.auth.currentUser / currentWorkspace.
  const mockContainer = {
    auth: {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      currentWorkspace: vi.fn().mockResolvedValue({ id: MOCK_WORKSPACE_ID }),
    },
  } as unknown as Container;

  app.decorate('container', mockContainer);

  // Error handler — mirrors the AppError branch in production app.ts so that
  // NotFoundError thrown by service.generate() maps to HTTP 404 (AC-4).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      void reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
      return;
    }
    void reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  await app.register(briefRoutes);
  return app;
}

// ============================================================================
// AC-2: GET /pulls/:id/brief → 404 when no cached row exists
// ============================================================================

describe('brief routes: AC-2 — GET /pulls/:id/brief returns 404 when no brief cached', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Simulate "no cached brief row" — service.get() returns null.
    (BriefService.prototype.get as Mock).mockResolvedValue(null);
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns HTTP 404 with error code not_found when service.get() returns null', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/pulls/${MOCK_PR_ID}/brief`,
    });

    expect(response.statusCode).toBe(404);

    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });
});

// ============================================================================
// AC-4: POST /pulls/:id/brief → 404 on workspace mismatch
// ============================================================================

describe('brief routes: AC-4 — POST /pulls/:id/brief returns 404 on workspace mismatch', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Simulate a PR UUID that belongs to a different workspace:
    // loadPull() inside service.generate() throws NotFoundError.
    (BriefService.prototype.generate as Mock).mockRejectedValue(
      new NotFoundError('Pull request not found'),
    );
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns HTTP 404 with error code not_found when PR belongs to a different workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/pulls/${MOCK_PR_ID}/brief`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });

    expect(response.statusCode).toBe(404);

    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
  });
});
