import { describe, expect, it, vi } from 'vitest';
import type { DevDigestClient } from '../client.js';
import { registerListAgents } from './list-agents.js';
import { captureTool, invokeAndParse, mockClient } from './test-helpers.js';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Finds security issues',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    system_prompt: 'x'.repeat(5000),
    output_schema: { some: 'schema' },
    enabled: true,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

describe('list_agents tool', () => {
  it('strips system_prompt from output even when present in the API response', async () => {
    const client = mockClient({ get: vi.fn(async () => [makeAgent()]) as DevDigestClient['get'] });
    const tool = captureTool(registerListAgents, client);
    const output = await invokeAndParse(tool);

    expect(output.agents).toHaveLength(1);
    expect(output.agents[0]).not.toHaveProperty('system_prompt');
    expect(output.agents[0]).not.toHaveProperty('output_schema');
    expect(output.agents[0]).toMatchObject({ id: 'agent-1', name: 'Security Reviewer' });
  });

  it('caps results at 50 agents', async () => {
    const agents = Array.from({ length: 75 }, (_, i) => makeAgent({ id: `agent-${i}` }));
    const client = mockClient({ get: vi.fn(async () => agents) as DevDigestClient['get'] });
    const tool = captureTool(registerListAgents, client);
    const output = await invokeAndParse(tool);

    expect(output.agents).toHaveLength(50);
    expect(output.total).toBe(75);
  });
});
