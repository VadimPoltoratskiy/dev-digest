import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestClient } from '../client.js';
import { AgentSummary } from '../types.js';

const MAX_AGENTS = 50;

export function registerListAgents(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'list_agents',
    {
      description: 'List review agents configured in DevDigest.',
      inputSchema: {},
    },
    async () => {
      const raw = await client.get<unknown[]>('/agents');
      const agents = AgentSummary.array().parse(raw).slice(0, MAX_AGENTS);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ agents, total: raw.length }, null, 2) }],
      };
    },
  );
}
