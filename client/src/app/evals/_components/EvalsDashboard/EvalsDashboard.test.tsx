import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalDashboard, EvalDashboardAgentSummary, EvalRunRecord, EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

vi.mock("../../../../lib/hooks/agents-eval", () => ({
  useEvalsDashboard: vi.fn(),
  useEvalsDashboardAgents: vi.fn(),
}));

vi.mock("../../../../lib/api", () => ({
  postAgentEvalRuns: vi.fn(),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { useEvalsDashboard, useEvalsDashboardAgents } from "../../../../lib/hooks/agents-eval";
import { postAgentEvalRuns } from "../../../../lib/api";
import { EvalsDashboard } from "./EvalsDashboard";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Default: no agents in the list — most dashboard tests don't care about it. */
function setupDefaultAgentsMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEvalsDashboardAgents).mockReturnValue({ data: [], isLoading: false, isError: false } as any);
}

beforeEach(setupDefaultAgentsMock);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECENT_RUNS: EvalRunRecord[] = [
  {
    id: "r1",
    case_id: "c1",
    case_name: "Config secret",
    ran_at: "2026-07-01T10:00:00.000Z",
    actual_output: null,
    pass: true,
    recall: 0.75,
    precision: 0.88,
    citation_accuracy: 0.95,
    duration_ms: 200,
    cost_usd: 0.003,
  },
  {
    id: "r2",
    case_id: "c2",
    case_name: "SQL injection",
    ran_at: "2026-07-01T10:00:00.000Z",
    actual_output: null,
    pass: false,
    recall: 0.75,
    precision: 0.88,
    citation_accuracy: 0.95,
    duration_ms: 180,
    cost_usd: 0.002,
  },
];

const DASHBOARD_DATA: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 5,
  current: {
    recall: 0.75,
    precision: 0.88,
    citation_accuracy: 0.95,
    traces_passed: 3,
    traces_total: 5,
    cost_usd: 0.01,
  },
  delta: {
    recall: 0.1,
    precision: -0.05,
    citation_accuracy: 0.0,
  },
  trend: [],
  recent_runs: RECENT_RUNS,
  alert: null,
};

const AGENT_SUMMARIES: EvalDashboardAgentSummary[] = [
  {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    version: 7,
    cases_total: 20,
    last_ran_at: "2026-05-29T09:14:00.000Z",
    current: { recall: 0.82, precision: 0.91, citation_accuracy: 0.95 },
    trend: [0.7, 0.75, 0.8, 0.82],
  },
  {
    agent_id: "ag2",
    agent_name: "Performance Reviewer",
    provider: "openai",
    model: "gpt-4o",
    version: 4,
    cases_total: 18,
    last_ran_at: null,
    current: null,
    trend: [],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalsDashboard — with data", () => {
  it("renders the page title and case summary", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
    // 5 cases, 2 recent runs in RECENT_RUNS
    expect(screen.getByText(/5 eval cases/)).toBeInTheDocument();
  });

  it("renders current metric values as visible text", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    // Metric card labels (uppercase)
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();

    // Metric values rendered as large text (EvalMetricCards passes the number, no % suffix text node)
    expect(screen.getAllByText("75.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("88.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("95.0").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a metric trend chart with a legend when trend has points", () => {
    const trend: EvalTrendPoint[] = [
      { ran_at: "2026-06-29T10:00:00.000Z", recall: 0.7, precision: 0.8, citation_accuracy: 0.9, pass_rate: 0.6, cost_usd: 0.01 },
      { ran_at: "2026-07-01T10:00:00.000Z", recall: 0.75, precision: 0.88, citation_accuracy: 0.95, pass_rate: 0.6, cost_usd: 0.012 },
    ];
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: { ...DASHBOARD_DATA, trend },
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    // Legend renders one entry per series — same label text is also used elsewhere (recent runs
    // badges), so assert presence via getAllByText rather than a single unique match.
    expect(screen.getAllByText("Recall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Precision").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Citation").length).toBeGreaterThanOrEqual(1);
  });

  it("does not render the trend section when trend is empty", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.queryByText("Metric trend")).not.toBeInTheDocument();
  });

  it("renders recent run case names", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.getByText("Config secret")).toBeInTheDocument();
    expect(screen.getByText("SQL injection")).toBeInTheDocument();
  });
});

describe("EvalsDashboard — empty state", () => {
  it("shows 'no runs yet' message when recent_runs is empty", () => {
    const emptyDashboard: EvalDashboard = {
      ...DASHBOARD_DATA,
      recent_runs: [],
      // When no runs, current/delta values are still present in data but not shown
      current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    };

    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: emptyDashboard,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    expect(
      screen.getByText("No runs yet. Create an eval case and run it."),
    ).toBeInTheDocument();

    // Metric cards should NOT be shown when there are no runs
    expect(screen.queryByText("RECALL")).not.toBeInTheDocument();
  });
});

describe("EvalsDashboard — agents list", () => {
  beforeEach(() => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it("renders one row per agent with name, model badge, and metrics", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEvalsDashboardAgents).mockReturnValue({ data: AGENT_SUMMARIES, isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/never run/)).toBeInTheDocument();
  });

  it("shows the empty-agents message when there are no agents", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEvalsDashboardAgents).mockReturnValue({ data: [], isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsDashboard />);

    expect(screen.getByText("No agents yet.")).toBeInTheDocument();
  });

  it("fans out a run request per agent on 'Run all agents' and shows a running state", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEvalsDashboardAgents).mockReturnValue({ data: AGENT_SUMMARIES, isLoading: false, isError: false } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(postAgentEvalRuns).mockResolvedValue({} as any);

    renderWithIntl(<EvalsDashboard />);

    fireEvent.click(screen.getByText("Run all agents"));

    expect(postAgentEvalRuns).toHaveBeenCalledWith("ag1");
    expect(postAgentEvalRuns).toHaveBeenCalledWith("ag2");
    expect(postAgentEvalRuns).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(screen.getByText("Run all agents")).not.toBeDisabled();
    });
  });
});
