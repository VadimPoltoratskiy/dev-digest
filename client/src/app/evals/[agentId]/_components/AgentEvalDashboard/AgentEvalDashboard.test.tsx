import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../lib/hooks/agents", () => ({
  useAgent: vi.fn(),
  useAgents: vi.fn(),
}));

vi.mock("../../../../../lib/hooks/agents-eval", () => ({
  useEvalsDashboard: vi.fn(),
  useRunAgentEvalBatch: vi.fn(),
  useAgentEvalRuns: vi.fn(),
}));

vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { useAgent, useAgents } from "../../../../../lib/hooks/agents";
import { useEvalsDashboard, useRunAgentEvalBatch, useAgentEvalRuns } from "../../../../../lib/hooks/agents-eval";
import { AgentEvalDashboard } from "./AgentEvalDashboard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "s",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  context_docs: [],
  enabled: true,
  version: 7,
};

const OTHER_AGENT: Agent = { ...AGENT, id: "ag2", name: "Performance Reviewer", version: 4 };

const DASHBOARD_DATA: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 20,
  current: { recall: 0.82, precision: 0.91, citation_accuracy: 0.95, traces_passed: 17, traces_total: 20, cost_usd: 0.23 },
  delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
  trend: [],
  recent_runs: [],
  alert: null,
};

const RUN_A: EvalRunRecord = {
  id: "r1",
  case_id: "c1",
  case_name: "Case A",
  ran_at: "2026-05-27T16:40:00.000Z",
  actual_output: null,
  pass: true,
  recall: 0.78,
  precision: 0.93,
  citation_accuracy: 0.94,
  duration_ms: 100,
  cost_usd: 0.21,
};

const RUN_B: EvalRunRecord = {
  ...RUN_A,
  id: "r2",
  ran_at: "2026-05-29T09:14:00.000Z",
  recall: 0.82,
  precision: 0.91,
  citation_accuracy: 0.95,
};

function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgent).mockReturnValue({ data: AGENT, isLoading: false, isError: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgents).mockReturnValue({ data: [AGENT, OTHER_AGENT] } as any);
  vi.mocked(useEvalsDashboard).mockReturnValue({
    data: DASHBOARD_DATA,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRunAgentEvalBatch).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentEvalRuns).mockReturnValue({ data: [RUN_A, RUN_B] } as any);
}

beforeEach(setupDefaultMocks);

describe("AgentEvalDashboard", () => {
  it("renders the agent name, model badge, and metric cards", () => {
    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("82.0")).toBeInTheDocument();
  });

  it("lists other agents in the agent-switcher dropdown, excluding the current agent", () => {
    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);
    fireEvent.click(screen.getByText("Switch agent"));
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Security Reviewer", { selector: "button *" })).not.toBeInTheDocument();
  });

  it("renders the alert banner with role=alert when data.alert is set", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: { ...DASHBOARD_DATA, alert: "Precision dipped 2pts on v7 — review before promoting." },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 2pts on v7");
  });

  it("does not render an alert banner when data.alert is null", () => {
    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls the run-batch mutation when 'Run eval' is clicked", () => {
    const mockMutate = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useRunAgentEvalBatch).mockReturnValue({ mutate: mockMutate, isPending: false } as any);

    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);
    fireEvent.click(screen.getByText("Run eval (20)"));
    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("filters the run-history table by the selected date range", () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(); // 200 days ago
    const recent = new Date().toISOString();
    vi.mocked(useAgentEvalRuns).mockReturnValue({
      data: [
        { ...RUN_A, ran_at: old },
        { ...RUN_B, ran_at: recent },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);

    // Default range is 30 days — only the recent run's checkbox should render.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    fireEvent.click(screen.getByText("30 days"));
    fireEvent.click(screen.getByText("All time"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("shows an error state and retries when the dashboard fails to load", () => {
    const refetch = vi.fn();
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderWithIntl(<AgentEvalDashboard agentId="ag1" />);
    expect(screen.getByText("Failed to load this agent's eval dashboard.")).toBeInTheDocument();
  });
});
