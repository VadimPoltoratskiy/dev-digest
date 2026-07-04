import { describe, expect, it, vi } from 'vitest';
import type { DevDigestClient } from '../client.js';
import { registerGetFindings } from './get-findings.js';
import { captureTool, invokeAndParse } from './test-helpers.js';

const REPOS = [{ id: 'repo-1', owner: 'acme', name: 'payments-api' }];
const PULLS = [{ id: 'pull-1', number: 482 }];

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'finding-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Off by one',
    file: 'src/x.ts',
    start_line: 1,
    end_line: 2,
    rationale: 'because',
    suggestion: null,
    ...overrides,
  };
}

function makeClientWith(routes: Record<string, unknown>): DevDigestClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === '/repos') return REPOS;
      if (path === '/repos/repo-1/pulls') return PULLS;
      if (path in routes) return routes[path];
      throw new Error(`no mock response for ${path}`);
    }) as DevDigestClient['get'],
    post: vi.fn() as DevDigestClient['post'],
  };
}

const baseArgs = { owner: 'acme', repo: 'payments-api', pr_number: 482, limit: 20 };

describe('get_findings tool', () => {
  it('returns findings sorted by severity when all runs are done', async () => {
    const runs = [
      { run_id: 'run-1', agent_id: 'a1', agent_name: 'Security', status: 'done', error: null, score: 80, findings_count: 2, ran_at: 't', cost_usd: 0.01 },
    ];
    const reviews = [
      {
        run_id: 'run-1',
        findings: [
          makeFinding({ id: 'f-sugg', severity: 'SUGGESTION' }),
          makeFinding({ id: 'f-crit', severity: 'CRITICAL' }),
        ],
      },
    ];
    const client = makeClientWith({ '/pulls/pull-1/runs': runs, '/pulls/pull-1/reviews': reviews });
    const tool = captureTool(registerGetFindings, client);
    const output = await invokeAndParse(tool, baseArgs);

    expect(output.status).toBe('done');
    expect(output.findings.map((f: { id: string }) => f.id)).toEqual(['f-crit', 'f-sugg']);
    expect(output.total_findings).toBe(2);
    expect(output.truncated).toBe(false);
  });

  it('reports running status with no findings key while a run is in flight', async () => {
    const runs = [
      { run_id: 'run-1', agent_id: 'a1', agent_name: 'Security', status: 'running', error: null, score: null, findings_count: null, ran_at: null, cost_usd: null },
    ];
    const client = makeClientWith({ '/pulls/pull-1/runs': runs });
    const tool = captureTool(registerGetFindings, client);
    const output = await invokeAndParse(tool, baseArgs);

    expect(output.status).toBe('running');
    expect(output.findings).toBeUndefined();
  });

  it('filters to one run_id when provided', async () => {
    const runs = [
      { run_id: 'run-1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, score: 80, findings_count: 1, ran_at: 't', cost_usd: 0.01 },
      { run_id: 'run-2', agent_id: 'a2', agent_name: 'B', status: 'done', error: null, score: 90, findings_count: 1, ran_at: 't', cost_usd: 0.01 },
    ];
    const reviews = [
      { run_id: 'run-1', findings: [makeFinding({ id: 'f-1' })] },
      { run_id: 'run-2', findings: [makeFinding({ id: 'f-2' })] },
    ];
    const client = makeClientWith({ '/pulls/pull-1/runs': runs, '/pulls/pull-1/reviews': reviews });
    const tool = captureTool(registerGetFindings, client);
    const output = await invokeAndParse(tool, { ...baseArgs, run_id: 'run-1' });

    expect(output.runs).toHaveLength(1);
    expect(output.findings.map((f: { id: string }) => f.id)).toEqual(['f-1']);
  });

  it('throws NOT_FOUND when run_id is not in the run list', async () => {
    const runs = [
      { run_id: 'run-1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, score: 80, findings_count: 0, ran_at: 't', cost_usd: 0.01 },
    ];
    const client = makeClientWith({ '/pulls/pull-1/runs': runs });
    const tool = captureTool(registerGetFindings, client);
    await expect(tool.cb({ ...baseArgs, run_id: 'does-not-exist' })).rejects.toThrow(/not found for this PR/);
  });
});
