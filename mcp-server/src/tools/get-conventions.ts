import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';
import { resolveRepo } from '../resolve.js';
import { ConventionItem } from '../types.js';

const MAX_CONVENTIONS = 50;

const InputShape = {
  owner: z.string(),
  repo: z.string(),
  accepted_only: z.boolean().optional().default(false).describe('Return only accepted conventions'),
};

export function registerGetConventions(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'get_conventions',
    {
      description: 'Fetch extracted coding conventions for a repository.',
      inputSchema: InputShape,
    },
    async ({ owner, repo, accepted_only }) => {
      const repoId = await resolveRepo(client, owner, repo);
      const raw = ConventionItem.array().parse(await client.get<unknown[]>(`/repos/${repoId}/conventions`));
      const filtered = accepted_only ? raw.filter((c) => c.accepted) : raw;
      const conventions = filtered.slice(0, MAX_CONVENTIONS);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                repo: `${owner}/${repo}`,
                conventions,
                total: filtered.length,
                truncated: filtered.length > conventions.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
