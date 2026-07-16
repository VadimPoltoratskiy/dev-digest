import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';
import { resolveRepo } from '../resolve.js';
import { MemoryRecord } from '@devdigest/shared';

const MAX_MEMORY = 50;

const InputShape = {
  owner: z.string(),
  repo: z.string(),
  scope: z.enum(['repo', 'global', 'team']).optional(),
  kind: z.enum(['decision', 'convention', 'preference', 'fact', 'learning']).optional(),
  q: z.string().optional().describe('Optional search query'),
};

export function registerGetMemory(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'get_memory',
    { description: 'Fetch memory records for a repository.', inputSchema: InputShape },
    async ({ owner, repo, scope, kind, q }) => {
      const repoId = await resolveRepo(client, owner, repo);
      const params = new URLSearchParams({ repo: repoId });
      if (scope) params.set('scope', scope);
      if (kind) params.set('kind', kind);
      if (q) params.set('q', q);
      const raw = await client.get<unknown>(`/memory?${params}`);
      const parsed = z
        .object({ records: MemoryRecord.array(), search_mode: z.string().optional() })
        .parse(raw);
      const records = parsed.records.slice(0, MAX_MEMORY);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                repo: `${owner}/${repo}`,
                records,
                total: parsed.records.length,
                search_mode: parsed.search_mode,
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
