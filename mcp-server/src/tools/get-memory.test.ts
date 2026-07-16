import { describe, expect, it, vi } from 'vitest';
import type { DevDigestClient } from '../client.js';
import { registerGetMemory } from './get-memory.js';
import { captureTool, invokeAndParse } from './test-helpers.js';

const REPOS = [{ id: 'repo-1', owner: 'acme', name: 'payments-api' }];

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    content: 'Migrations never auto-run — always cd server && pnpm db:migrate',
    scope: 'repo',
    kind: 'convention',
    confidence: 1.0,
    sources: [{ context: 'CLAUDE.md', pr: null }],
    updated_at: '2026-07-16T00:00:00.000Z',
    last_used_at: null,
    ...overrides,
  };
}

function makeClient(memoryResponse: unknown): DevDigestClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === '/repos') return REPOS;
      if ((path as string).startsWith('/memory?')) return memoryResponse;
      throw new Error(`no mock response for ${path}`);
    }) as DevDigestClient['get'],
    post: vi.fn() as DevDigestClient['post'],
  };
}

const baseArgs = { owner: 'acme', repo: 'payments-api' };

describe('get_memory tool', () => {
  it('returns records validated against MemoryRecord schema', async () => {
    const record = makeRecord();
    const client = makeClient({ records: [record], search_mode: 'text' });
    const tool = captureTool(registerGetMemory, client);
    const output = await invokeAndParse(tool, baseArgs);

    expect(output.repo).toBe('acme/payments-api');
    expect(output.records).toHaveLength(1);
    expect(output.records[0].id).toBe(record.id);
    expect(output.records[0].content).toBe(record.content);
    expect(output.records[0].scope).toBe('repo');
    expect(output.records[0].kind).toBe('convention');
    expect(output.search_mode).toBe('text');
    expect(output.total).toBe(1);
  });

  it('caps results at 50 records and reports the real total', async () => {
    const records = Array.from({ length: 75 }, (_, i) =>
      makeRecord({
        id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
      }),
    );
    const client = makeClient({ records });
    const tool = captureTool(registerGetMemory, client);
    const output = await invokeAndParse(tool, baseArgs);

    expect(output.records).toHaveLength(50);
    expect(output.total).toBe(75);
  });

  it('rejects invalid MemoryRecord shapes from the API with a Zod error', async () => {
    // Missing required fields — Zod parse must throw
    const client = makeClient({ records: [{ id: 'not-a-uuid', content: 'x' }] });
    const tool = captureTool(registerGetMemory, client);
    await expect(tool.cb(baseArgs)).rejects.toThrow();
  });

  it('forwards optional scope, kind, and q params in the query string', async () => {
    const record = makeRecord();
    const client = makeClient({ records: [record] });
    const tool = captureTool(registerGetMemory, client);
    await invokeAndParse(tool, { ...baseArgs, scope: 'repo', kind: 'convention', q: 'migration' });

    const getCall = vi.mocked(client.get).mock.calls.find(
      ([path]) => (path as string).startsWith('/memory?'),
    );
    expect(getCall?.[0]).toContain('scope=repo');
    expect(getCall?.[0]).toContain('kind=convention');
    expect(getCall?.[0]).toContain('q=migration');
  });

  it('omits optional params from the query string when not provided', async () => {
    const client = makeClient({ records: [] });
    const tool = captureTool(registerGetMemory, client);
    await invokeAndParse(tool, baseArgs);

    const getCall = vi.mocked(client.get).mock.calls.find(
      ([path]) => (path as string).startsWith('/memory?'),
    );
    const url = getCall?.[0] as string;
    expect(url).not.toContain('scope=');
    expect(url).not.toContain('kind=');
    expect(url).not.toContain('q=');
  });

  it('throws REPO_NOT_FOUND for an unknown repo', async () => {
    const client = makeClient({ records: [] });
    const tool = captureTool(registerGetMemory, client);
    await expect(tool.cb({ ...baseArgs, repo: 'unknown' })).rejects.toThrow(/not found/i);
  });
});
