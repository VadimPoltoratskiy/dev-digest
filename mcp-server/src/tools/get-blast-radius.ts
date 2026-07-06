import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';
import { resolveRepo } from '../resolve.js';
import { BlastRadius } from '../types.js';

const InputShape = {
  owner: z.string(),
  repo: z.string(),
  files: z.array(z.string()).describe('Changed file paths'),
};

/**
 * Impact analysis for changed files. Reads DevDigest's ready-made repo-intel
 * index via the server route (POST /repos/:id/blast) — no analysis, no model
 * call. resolveRepo(owner, repo) -> repoId, then POST the changed file list.
 */
export function registerGetBlastRadius(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'get_blast_radius',
    {
      description:
        'Impact analysis for changed files: which symbols they declare, who calls those ' +
        'symbols, and which HTTP endpoints/crons are reachable. Reads the repo-intel index.',
      inputSchema: InputShape,
    },
    async ({ owner, repo, files }) => {
      const repoId = await resolveRepo(client, owner, repo);
      const blast = BlastRadius.parse(await client.post<unknown>(`/repos/${repoId}/blast`, { files }));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ repo: `${owner}/${repo}`, ...blast }, null, 2),
          },
        ],
      };
    },
  );
}
