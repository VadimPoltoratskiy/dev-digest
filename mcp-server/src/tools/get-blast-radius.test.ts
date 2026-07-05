import { describe, expect, it, vi } from 'vitest';
import type { DevDigestClient } from '../client.js';
import { registerGetBlastRadius } from './get-blast-radius.js';
import { captureTool, invokeAndParse } from './test-helpers.js';

const REPOS = [{ id: 'repo-1', owner: 'acme', name: 'payments-api' }];

const BLAST = {
  changed_symbols: [{ name: 'rateLimit', file: 'src/shared/helper.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'rateLimit',
      callers: [
        { name: 'handler', file: 'src/api/public/index.ts', line: 23 },
        { name: 'webhook', file: 'src/api/public/webhooks.ts', line: 45 },
      ],
      endpoints_affected: ['GET /api/public/items', 'POST /api/public/webhooks'],
      crons_affected: [],
    },
  ],
  summary: '1 changed symbol reach 2 callers across 2 endpoints.',
};

function makeClient(post: DevDigestClient['post']): DevDigestClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === '/repos') return REPOS;
      throw new Error(`no mock response for ${path}`);
    }) as DevDigestClient['get'],
    post,
  };
}

const args = { owner: 'acme', repo: 'payments-api', files: ['src/shared/helper.ts'] };

describe('get_blast_radius tool', () => {
  it('resolves the repo and POSTs the changed files to the blast route', async () => {
    const post = vi.fn(async () => BLAST) as unknown as DevDigestClient['post'];
    const client = makeClient(post);
    const tool = captureTool(registerGetBlastRadius, client);

    const output = await invokeAndParse(tool, args);

    expect(post).toHaveBeenCalledWith('/repos/repo-1/blast', { files: ['src/shared/helper.ts'] });
    expect(output.repo).toBe('acme/payments-api');
    expect(output.downstream[0].callers).toHaveLength(2);
    expect(output.downstream[0].endpoints_affected.length).toBeGreaterThanOrEqual(1);
    // No longer a stub.
    expect(output.implemented).toBeUndefined();
  });

  it('throws REPO_NOT_FOUND for an unknown repo', async () => {
    const post = vi.fn() as unknown as DevDigestClient['post'];
    const client = makeClient(post);
    const tool = captureTool(registerGetBlastRadius, client);

    await expect(tool.cb({ ...args, repo: 'nope' })).rejects.toThrow(/not found/i);
    expect(post).not.toHaveBeenCalled();
  });
});
