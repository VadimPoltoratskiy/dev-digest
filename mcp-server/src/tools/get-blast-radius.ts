import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';

const InputShape = {
  owner: z.string(),
  repo: z.string(),
  files: z.array(z.string()).describe('Changed file paths'),
};

/**
 * Stub — RepoIntelService.getBlastRadius already exists server-side
 * (server/src/modules/repo-intel/service.ts) but has no HTTP route yet.
 * When wiring this up for real: resolveRepo(owner, repo) -> repoId, then call
 * the new blast-radius route once it's added to repo-intel/routes.ts.
 */
export function registerGetBlastRadius(server: McpServer, _client: DevDigestClient) {
  server.registerTool(
    'get_blast_radius',
    {
      description: '[Stub] Impact analysis for changed files. Not yet implemented.',
      inputSchema: InputShape,
    },
    async () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                implemented: false,
                message:
                  'Get Blast Radius is not implemented in this phase. The underlying service exists in DevDigest (RepoIntelService.getBlastRadius) but is not yet wired to the MCP tool. Check back in a future release.',
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
