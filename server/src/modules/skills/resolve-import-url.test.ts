/**
 * Unit tests for `resolveImportUrl` and integration tests for
 * POST /skills/import/fetch (with global fetch mocked).
 */

// ============================================================================
// Module-level mocks — hoisted by Vitest (must be before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./service.js', () => {
  const SkillsService = vi.fn();
  SkillsService.prototype.list = vi.fn();
  SkillsService.prototype.get = vi.fn();
  SkillsService.prototype.create = vi.fn();
  SkillsService.prototype.update = vi.fn();
  SkillsService.prototype.toggle = vi.fn();
  SkillsService.prototype.delete = vi.fn();
  SkillsService.prototype.listVersions = vi.fn();
  SkillsService.prototype.restoreVersion = vi.fn();
  SkillsService.prototype.stats = vi.fn();
  SkillsService.prototype.listEvalCases = vi.fn();
  SkillsService.prototype.createEvalCase = vi.fn();
  SkillsService.prototype.updateEvalCase = vi.fn();
  SkillsService.prototype.deleteEvalCase = vi.fn();
  SkillsService.prototype.runEvalCase = vi.fn();
  SkillsService.prototype.runAllEvalCases = vi.fn();
  SkillsService.prototype.generateEvalCase = vi.fn();
  SkillsService.prototype.setContextDocs = vi.fn();
  return { SkillsService };
});

// ============================================================================
// Imports — after vi.mock() declarations
// ============================================================================

import Fastify, { type FastifyInstance } from 'fastify';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { AppError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import skillsRoutes, { resolveImportUrl } from './routes.js';

// ============================================================================
// Unit tests: resolveImportUrl (pure function, no I/O)
// ============================================================================

describe('resolveImportUrl', () => {
  // ---- Allowed hosts ----

  it('passes through raw.githubusercontent.com URLs unchanged', () => {
    const url = 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md';
    expect(resolveImportUrl(url)).toBe(url);
  });

  it('passes through gist.githubusercontent.com URLs unchanged', () => {
    const url = 'https://gist.githubusercontent.com/user/abc123/raw/file.md';
    expect(resolveImportUrl(url)).toBe(url);
  });

  it('converts a github.com blob URL to raw.githubusercontent.com', () => {
    const input = 'https://github.com/owner/repo/blob/main/SKILL.md';
    const expected = 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md';
    expect(resolveImportUrl(input)).toBe(expected);
  });

  it('converts a github.com blob URL with nested path', () => {
    const input = 'https://github.com/owner/repo/blob/main/src/skills/auth.md';
    const expected = 'https://raw.githubusercontent.com/owner/repo/main/src/skills/auth.md';
    expect(resolveImportUrl(input)).toBe(expected);
  });

  it('converts a github.com blob URL with a sha ref', () => {
    const input = 'https://github.com/owner/repo/blob/abc1234def5/file.md';
    const expected = 'https://raw.githubusercontent.com/owner/repo/abc1234def5/file.md';
    expect(resolveImportUrl(input)).toBe(expected);
  });

  // ---- Protocol rejection ----

  it('rejects http:// URLs', () => {
    expect(() =>
      resolveImportUrl('http://raw.githubusercontent.com/owner/repo/main/file.md'),
    ).toThrow('Only https://');
  });

  it('rejects ftp:// URLs', () => {
    expect(() =>
      resolveImportUrl('ftp://raw.githubusercontent.com/owner/repo/main/file.md'),
    ).toThrow('Only https://');
  });

  // ---- Host allowlist rejection ----

  it('rejects hosts not in the allowlist (example.com)', () => {
    expect(() => resolveImportUrl('https://example.com/skills.md')).toThrow(/not supported/);
  });

  it('rejects github.com.evil.com (subdomain spoofing — endsWith bypass attempt)', () => {
    expect(() =>
      resolveImportUrl('https://github.com.evil.com/owner/repo/blob/main/file.md'),
    ).toThrow(/not supported/);
  });

  it('rejects evil-github.com (similar-name domain)', () => {
    expect(() =>
      resolveImportUrl('https://evil-github.com/owner/repo/blob/main/file.md'),
    ).toThrow(/not supported/);
  });

  it('rejects raw.githubusercontent.com.evil.com', () => {
    expect(() =>
      resolveImportUrl('https://raw.githubusercontent.com.evil.com/file.md'),
    ).toThrow(/not supported/);
  });

  // ---- Credential rejection ----

  it('rejects URLs with a username', () => {
    expect(() =>
      resolveImportUrl('https://user@raw.githubusercontent.com/owner/repo/main/file.md'),
    ).toThrow(/credentials/);
  });

  it('rejects URLs with both username and password', () => {
    expect(() =>
      resolveImportUrl('https://user:pass@raw.githubusercontent.com/owner/repo/main/file.md'),
    ).toThrow(/credentials/);
  });

  // ---- non-default port rejection ----

  it('rejects a non-default port on an allowlisted host', () => {
    expect(() =>
      resolveImportUrl('https://raw.githubusercontent.com:22/owner/repo/main/file.md'),
    ).toThrow(/port/);
  });

  it('allows an explicit :443 port (normalised away by the URL parser)', () => {
    // WHATWG URL drops the scheme-default port, so :443 is accepted and stripped.
    expect(
      resolveImportUrl('https://raw.githubusercontent.com:443/owner/repo/main/file.md'),
    ).toBe('https://raw.githubusercontent.com/owner/repo/main/file.md');
  });

  // ---- github.com non-blob rejection ----

  it('rejects github.com repository root URLs (no blob)', () => {
    expect(() => resolveImportUrl('https://github.com/owner/repo')).toThrow(/blob/);
  });

  it('rejects github.com tree URLs', () => {
    expect(() =>
      resolveImportUrl('https://github.com/owner/repo/tree/main'),
    ).toThrow(/blob/);
  });

  it('rejects github.com pull request URLs', () => {
    expect(() =>
      resolveImportUrl('https://github.com/owner/repo/pull/42'),
    ).toThrow(/blob/);
  });

  // ---- Invalid URL ----

  it('rejects completely invalid URL strings', () => {
    expect(() => resolveImportUrl('not-a-url')).toThrow('Invalid URL');
  });

  it('rejects empty string', () => {
    expect(() => resolveImportUrl('')).toThrow('Invalid URL');
  });
});

// ============================================================================
// Handler tests: POST /skills/import/fetch (fetch mocked globally)
// ============================================================================

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const mockContainer = {
    auth: {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      currentWorkspace: vi.fn().mockResolvedValue({ id: 'ws-id' }),
    },
  } as unknown as Container;

  app.decorate('container', mockContainer);

  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      void reply.status(422).send({
        error: { code: 'validation_error', message: 'Validation failed' },
      });
      return;
    }
    if (err instanceof AppError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    void reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  await app.register(skillsRoutes);
  return app;
}

describe('POST /skills/import/fetch', () => {
  let app: FastifyInstance;
  let restoreFetch: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    restoreFetch?.();
    await app.close();
  });

  it('returns 422 when url is missing from the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/skills/import/fetch', payload: {} });
    expect(res.statusCode).toBe(422);
  });

  it('returns 422 when url is not a valid URL string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'not-a-url' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 400 when the URL host is not in the allowlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://example.com/skill.md' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_url');
  });

  it('returns 400 when the URL uses http://', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'http://raw.githubusercontent.com/owner/repo/main/file.md' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_url');
  });

  it('returns 502 when global fetch rejects (e.g. redirect encountered)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('redirect mode is set to error'));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/skill.md' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('fetch_failed');
  });

  it('returns 502 when the remote returns a non-OK status', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/skill.md' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('fetch_error');
  });

  it('returns 400 when Content-Length header exceeds 256 KB', async () => {
    const headers = new Headers({ 'content-length': String(256 * 1024 + 1) });
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200, headers }));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/skill.md' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('content_too_large');
  });

  it('returns 400 when response body text exceeds 256 KB', async () => {
    const bigText = 'a'.repeat(256 * 1024 + 1);
    const mockFetch = vi.fn().mockResolvedValue(new Response(bigText, { status: 200 }));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/skill.md' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('content_too_large');
  });

  it('returns name/body_preview/token_count on happy path', async () => {
    const content = '# My Great Skill\n\nThis skill enforces code quality.';
    const mockFetch = vi.fn().mockResolvedValue(new Response(content, { status: 200 }));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/skill.md' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; body_preview: string; token_count: number };
    expect(body.name).toBe('My Great Skill');
    expect(body.body_preview).toContain('My Great Skill');
    expect(typeof body.token_count).toBe('number');
    expect(body.token_count).toBeGreaterThan(0);
  });

  it('derives name from path segment when no heading is present', async () => {
    const content = 'Just rules with no heading.';
    const mockFetch = vi.fn().mockResolvedValue(new Response(content, { status: 200 }));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://raw.githubusercontent.com/owner/repo/main/my-skill.md' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string };
    expect(body.name).toBe('my-skill'); // filename without extension
  });

  it('converts github.com blob URL before fetching', async () => {
    const content = '# GitHub Skill\n\nContent.';
    const mockFetch = vi.fn().mockResolvedValue(new Response(content, { status: 200 }));
    restoreFetch = () => vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/fetch',
      payload: { url: 'https://github.com/owner/repo/blob/main/SKILL.md' },
    });

    expect(res.statusCode).toBe(200);
    // The fetch should have been called with the raw URL, not the github.com URL
    expect(mockFetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/repo/main/SKILL.md',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
});
