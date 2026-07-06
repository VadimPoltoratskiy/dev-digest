import { describe, expect, it, vi } from 'vitest';
import type { DevDigestClient } from './client.js';
import { resolveOwnerRepoPr, resolvePull, resolveRepo } from './resolve.js';

function makeMockClient(responses: Record<string, unknown>): DevDigestClient {
  return {
    get: vi.fn(async (path: string) => {
      if (!(path in responses)) throw new Error(`no mock response for ${path}`);
      return responses[path];
    }) as DevDigestClient['get'],
    post: vi.fn() as DevDigestClient['post'],
  };
}

const REPOS = [
  { id: 'repo-1', owner: 'Acme', name: 'Payments-Api' },
  { id: 'repo-2', owner: 'other', name: 'thing' },
];

const PULLS = [
  { id: 'pull-1', number: 482 },
  { id: 'pull-2', number: 99 },
];

describe('resolveRepo', () => {
  it('finds the correct repo case-insensitively', async () => {
    const client = makeMockClient({ '/repos': REPOS });
    const id = await resolveRepo(client, 'acme', 'payments-api');
    expect(id).toBe('repo-1');
  });

  it('throws with a not-found message when no match', async () => {
    const client = makeMockClient({ '/repos': REPOS });
    await expect(resolveRepo(client, 'nope', 'nope')).rejects.toThrow(/not found in DevDigest/);
  });
});

describe('resolvePull', () => {
  it('finds the correct pull by number', async () => {
    const client = makeMockClient({ '/repos/repo-1/pulls': PULLS });
    const id = await resolvePull(client, 'repo-1', 482);
    expect(id).toBe('pull-1');
  });

  it('throws a not-synced message when no match', async () => {
    const client = makeMockClient({ '/repos/repo-1/pulls': PULLS });
    await expect(resolvePull(client, 'repo-1', 1)).rejects.toThrow(/not found in DevDigest/);
  });
});

describe('resolveOwnerRepoPr', () => {
  it('chains repo and pull resolution', async () => {
    const client = makeMockClient({
      '/repos': REPOS,
      '/repos/repo-1/pulls': PULLS,
    });
    const result = await resolveOwnerRepoPr(client, 'Acme', 'Payments-Api', 482);
    expect(result).toEqual({ repoId: 'repo-1', pullId: 'pull-1' });
  });
});
