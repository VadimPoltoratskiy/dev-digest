/**
 * Unit tests for AgentsService.skillCounts
 * Hermetic — no real DB, no network.
 */

// ============================================================================
// Module-level mocks (hoisted by Vitest — must be at top, before imports)
// ============================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('./repository.js', () => {
  const AgentsRepository = vi.fn();
  AgentsRepository.prototype.skillCounts = vi.fn();
  return { AgentsRepository };
});

// ============================================================================
// Imports — must come after vi.mock() calls
// ============================================================================

import { AgentsRepository } from './repository.js';
import { AgentsService } from './service.js';
import type { Container } from '../../platform/container.js';

// ============================================================================
// Helpers
// ============================================================================

function mockRepo() {
  return AgentsRepository.prototype as unknown as Record<string, Mock>;
}

function makeContainer(): Container {
  return { db: {} as never } as unknown as Container;
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentsService.skillCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when the repository returns no rows', async () => {
    const container = makeContainer();
    mockRepo().skillCounts!.mockResolvedValue([]);

    const service = new AgentsService(container);
    const result = await service.skillCounts('ws-1');

    expect(result).toEqual([]);
    expect(mockRepo().skillCounts!).toHaveBeenCalledWith('ws-1');
  });

  it('maps repository rows { agentId, count } to AgentSkillCount { agent_id, count }', async () => {
    const container = makeContainer();
    mockRepo().skillCounts!.mockResolvedValue([
      { agentId: 'agent-a', count: 3 },
      { agentId: 'agent-b', count: 1 },
    ]);

    const service = new AgentsService(container);
    const result = await service.skillCounts('ws-1');

    expect(result).toEqual([
      { agent_id: 'agent-a', count: 3 },
      { agent_id: 'agent-b', count: 1 },
    ]);
  });

  it('passes workspaceId correctly to the repository', async () => {
    const container = makeContainer();
    mockRepo().skillCounts!.mockResolvedValue([]);

    const service = new AgentsService(container);
    await service.skillCounts('my-workspace-id');

    expect(mockRepo().skillCounts!).toHaveBeenCalledWith('my-workspace-id');
  });
});
