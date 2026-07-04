import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';
import { resolveOwnerRepoPr } from '../resolve.js';
import { RunTarget } from '../types.js';

const InputShape = {
  owner: z.string().describe('GitHub org or username'),
  repo: z.string().describe('Repository name'),
  pr_number: z.number().int().positive().describe('Pull request number'),
  agent_id: z.string().uuid().optional().describe('Agent ID; omit to run all enabled agents'),
};

export function registerRunAgent(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'run_agent',
    {
      description:
        'Trigger a review agent on a pull request. Returns run IDs immediately; the review runs asynchronously.',
      inputSchema: InputShape,
    },
    async ({ owner, repo, pr_number, agent_id }) => {
      const { pullId } = await resolveOwnerRepoPr(client, owner, repo, pr_number);
      const body = agent_id ? { agentId: agent_id } : { all: true };
      const raw = await client.post<{ pr_id: string; runs: unknown[] }>(`/pulls/${pullId}/review`, body);
      const runs = RunTarget.array().parse(raw.runs);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                pull_id: pullId,
                runs,
                note: 'Review is running in the background. Call get_findings with the same owner/repo/pr_number to retrieve results.',
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
