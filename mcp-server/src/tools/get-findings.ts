import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DevDigestClient } from '../client.js';
import { McpToolError } from '../client.js';
import { resolveOwnerRepoPr } from '../resolve.js';
import { FindingSummary, ReviewRecordLite, RunStatus } from '../types.js';

const InputShape = {
  owner: z.string(),
  repo: z.string(),
  pr_number: z.number().int().positive(),
  run_id: z.string().optional().describe('Filter to one specific run'),
  limit: z.number().int().min(1).max(50).optional().default(20),
};

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 } as const;

function aggregateStatus(runs: RunStatus[]): 'running' | 'done' | 'partial' | 'failed' {
  if (runs.some((r) => r.status === 'running')) return 'running';
  const done = runs.filter((r) => r.status === 'done');
  if (done.length === runs.length) return 'done';
  if (done.length > 0) return 'partial';
  return 'failed';
}

export function registerGetFindings(server: McpServer, client: DevDigestClient) {
  server.registerTool(
    'get_findings',
    {
      description: 'Fetch findings for a pull request. Reports run status; returns findings when runs are done.',
      inputSchema: InputShape,
    },
    async ({ owner, repo, pr_number, run_id, limit }) => {
      const { pullId } = await resolveOwnerRepoPr(client, owner, repo, pr_number);

      let runs = RunStatus.array().parse(await client.get<unknown[]>(`/pulls/${pullId}/runs`));
      if (run_id) {
        runs = runs.filter((r) => r.run_id === run_id);
        if (runs.length === 0) {
          throw new McpToolError('RUN_NOT_FOUND', `Run ${run_id} not found for this PR.`);
        }
      }

      const status = aggregateStatus(runs);
      const summary = runs.map((r) => ({
        run_id: r.run_id,
        agent_name: r.agent_name,
        status: r.status,
        score: r.score,
        findings_count: r.findings_count,
        ran_at: r.ran_at,
        cost_usd: r.cost_usd,
      }));

      if (status === 'running') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status, runs: summary }) }],
        };
      }

      const reviews = ReviewRecordLite.array().parse(
        await client.get<unknown[]>(`/pulls/${pullId}/reviews`),
      );
      const relevantReviews = run_id ? reviews.filter((r) => r.run_id === run_id) : reviews;
      const allFindings: FindingSummary[] = relevantReviews.flatMap((r) => r.findings);
      allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

      const findings = allFindings.slice(0, limit);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status,
                runs: summary,
                findings,
                total_findings: allFindings.length,
                truncated: allFindings.length > findings.length,
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
