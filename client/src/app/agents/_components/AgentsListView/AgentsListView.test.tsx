import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import agentsMessages from "../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: vi.fn(),
  useAgentSkillCounts: vi.fn(),
  useUpdateAgent: vi.fn(),
  useDeleteAgent: vi.fn(),
}));

// Mock AppShell: renders children directly, avoiding router/context dependencies.
vi.mock("../../../../components/app-shell", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppShell: ({ children }: { children: any }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Import subjects under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { useAgents, useAgentSkillCounts, useUpdateAgent, useDeleteAgent } from "../../../../lib/hooks/agents";
import { AgentsListView } from "./AgentsListView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_1: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  context_docs: [],
  enabled: true,
  version: 1,
};

const AGENT_2: Agent = {
  id: "agent-2",
  name: "Style Checker",
  description: "Checks code style",
  provider: "anthropic",
  model: "claude-3-5-sonnet",
  system_prompt: "You are a style checker.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  context_docs: [],
  enabled: true,
  version: 1,
};

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

function setupDefaultMocks(overrides: {
  agents?: Agent[];
  skillCounts?: Array<{ agent_id: string; count: number }>;
  isLoading?: boolean;
  isError?: boolean;
} = {}) {
  const agents = overrides.agents ?? [AGENT_1, AGENT_2];
  const skillCounts = overrides.skillCounts ?? [
    { agent_id: "agent-1", count: 3 },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgents).mockReturnValue({
    data: agents,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    refetch: vi.fn(),
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentSkillCounts).mockReturnValue({
    data: skillCounts,
    isLoading: false,
    isError: false,
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUpdateAgent).mockReturnValue({ mutate: vi.fn() } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDeleteAgent).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
        <AgentsListView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentsListView", () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  it("renders agent names when agents are loaded", async () => {
    renderView();
    expect(await screen.findByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Style Checker")).toBeInTheDocument();
  });

  it("shows skill count badge for an agent with linked skills", async () => {
    // AGENT_1 has 3 skills via skillCounts mock
    renderView();
    expect(await screen.findByText("3 skills")).toBeInTheDocument();
  });

  it("shows '0 skills' badge for an agent not in skillCounts response", async () => {
    // AGENT_2 is NOT in skillCounts data — should default to 0
    renderView();
    // There should be at least one "0 skills" badge (for AGENT_2)
    const zeroBadges = await screen.findAllByText("0 skills");
    expect(zeroBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("passes correct skillCount to each AgentCard", async () => {
    setupDefaultMocks({
      agents: [AGENT_1],
      skillCounts: [{ agent_id: "agent-1", count: 5 }],
    });
    renderView();
    expect(await screen.findByText("5 skills")).toBeInTheDocument();
  });

  it("shows empty state when no agents exist", async () => {
    setupDefaultMocks({ agents: [], skillCounts: [] });
    renderView();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
  });
});
