import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerformance } from "@devdigest/shared";
import agentPerformanceMessages from "../../../../../messages/en/agentPerformance.json";

// ---------------------------------------------------------------------------
// Mock external dependencies (must be before imports of subject under test)
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockSearchParamsGet = vi.fn().mockReturnValue(null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
    toString: () => "",
  }),
}));

vi.mock("../../../../lib/hooks/performance", () => ({
  useAgentPerformance: vi.fn(),
}));

// AppShell: render children only, skip nav/context deps.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Import subjects after mocks
// ---------------------------------------------------------------------------

import { useAgentPerformance } from "../../../../lib/hooks/performance";
import { AgentPerformanceDashboard } from "./AgentPerformanceDashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSearchParamsGet.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_ROW_A: AgentPerformance["agents"][number] = {
  agent_id: "a1",
  agent_name: "ReviewBot",
  runs: 5,
  avg_cost_usd: 0.05,
  avg_duration_ms: 3000,
  accept_rate: 0.8,
  previous_accept_rate: 0.7,
  last_run_at: "2026-07-17T10:00:00.000Z",
  trend: [
    { label: "r1", value: 3 },
    { label: "r2", value: 2 },
  ],
};

const AGENT_ROW_DELETED: AgentPerformance["agents"][number] = {
  agent_id: null,
  agent_name: "(deleted agent)",
  runs: 2,
  avg_cost_usd: 0.01,
  avg_duration_ms: 1500,
  accept_rate: null,
  previous_accept_rate: null,
  last_run_at: "2026-07-16T08:00:00.000Z",
  trend: [],
};

const FIXTURE: AgentPerformance = {
  period: {
    preset: "7d",
    from: "2026-07-10T00:00:00.000Z",
    to: "2026-07-17T23:59:59.999Z",
  },
  summary: {
    total_runs: 7,
    runs_trend: [
      { label: "2026-07-10", value: 2 },
      { label: "2026-07-11", value: 5 },
    ],
    total_cost_usd: 0.26,
    previous_total_cost_usd: 0.20,
    avg_accept_rate: 0.75,
    most_active: {
      agent_id: "a1",
      agent_name: "ReviewBot",
      runs: 5,
      accept_rate: 0.8,
    },
  },
  agents: [AGENT_ROW_A, AGENT_ROW_DELETED],
  cost_by_agent: [
    { agent_id: "a1", agent_name: "ReviewBot", cost_usd: 0.25 },
    { agent_id: null, agent_name: "(deleted agent)", cost_usd: 0.01 },
  ],
  cost_by_model: [
    { model: "gpt-4o", cost_usd: 0.20 },
    { model: "unknown", cost_usd: 0.06 },
  ],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDashboard() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agentPerformance: agentPerformanceMessages }}
    >
      <AgentPerformanceDashboard />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentPerformanceDashboard", () => {
  it("loading — renders skeletons, no metric values", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // The skeleton divs use the .skeleton CSS class.
    const skeletons = document.querySelectorAll(".skeleton");
    expect(skeletons.length).toBeGreaterThan(0);

    // No metric values like "0%" or "$0" during loading.
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it("error — renders ErrorState with retry, no metric values", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // ErrorState renders with role="alert"
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Error title from i18n
    expect(screen.getByText(agentPerformanceMessages.loadError)).toBeInTheDocument();
    // No metric values
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("empty state — total_runs === 0 renders empty state title", () => {
    const emptyData: AgentPerformance = {
      ...FIXTURE,
      summary: {
        ...FIXTURE.summary,
        total_runs: 0,
        runs_trend: [],
        most_active: null,
        avg_accept_rate: null,
        total_cost_usd: null,
        previous_total_cost_usd: null,
      },
      agents: [],
      cost_by_agent: [],
      cost_by_model: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: emptyData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // Empty state title from i18n
    expect(
      screen.getByText(agentPerformanceMessages.empty.title),
    ).toBeInTheDocument();

    // No summary cards or table when empty
    expect(screen.queryByText(agentPerformanceMessages.summary.totalRuns)).toBeNull();
  });

  it("full data — renders 4 card titles, agent rows, cost legends", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // All 4 summary card labels
    expect(screen.getByText(agentPerformanceMessages.summary.totalRuns)).toBeInTheDocument();
    expect(screen.getByText(agentPerformanceMessages.summary.totalCost)).toBeInTheDocument();
    expect(screen.getByText(agentPerformanceMessages.summary.avgAcceptRate)).toBeInTheDocument();
    expect(screen.getByText(agentPerformanceMessages.summary.mostActive)).toBeInTheDocument();

    // Agent table header column labels
    expect(screen.getByText(agentPerformanceMessages.table.runs)).toBeInTheDocument();

    // Cost breakdown section labels
    expect(screen.getByText(agentPerformanceMessages.costByAgent)).toBeInTheDocument();
    expect(screen.getByText(agentPerformanceMessages.costByModel)).toBeInTheDocument();

    // Both donut legends include agent/model names.
    // "ReviewBot" appears in summary card AND table AND donut legend — use getAllByText.
    expect(screen.getAllByText("ReviewBot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
  });

  it("deleted-agent row — renders '(deleted agent)' name with no View button", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // "(deleted agent)" text is present (appears in table row AND in donut legend).
    expect(
      screen.getAllByText(agentPerformanceMessages.table.deletedAgent).length,
    ).toBeGreaterThan(0);

    // View button for ReviewBot is present
    expect(
      screen.getByRole("button", { name: new RegExp(`${agentPerformanceMessages.table.view} ReviewBot`, "i") }),
    ).toBeInTheDocument();

    // No View button for deleted agent (agent_id: null)
    // There should be exactly one "View" labelled button (for ReviewBot).
    const viewButtons = screen.queryAllByRole("button", {
      name: new RegExp(agentPerformanceMessages.table.view, "i"),
    });
    // Deleted agent has no View button — only ReviewBot's view button exists.
    const deletedViewButton = viewButtons.find((btn) =>
      btn.getAttribute("aria-label")?.includes("(deleted agent)"),
    );
    expect(deletedViewButton).toBeUndefined();
  });

  it("View deep-link — clicking View navigates with period param preserved", () => {
    // Simulate period=7d in search params
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "period" ? "7d" : null,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    const viewBtn = screen.getByRole("button", {
      name: new RegExp(`${agentPerformanceMessages.table.view} ReviewBot`, "i"),
    });
    fireEvent.click(viewBtn);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("/agents/a1?tab=stats"),
    );
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("period=7d"),
    );
  });

  it("null accept_rate row — renders '—' not '0%'", () => {
    const data: AgentPerformance = {
      ...FIXTURE,
      agents: [
        {
          ...AGENT_ROW_A,
          accept_rate: null,
          previous_accept_rate: null,
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // "—" placeholder appears for null accept rate
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // "0%" must not appear
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it("no cost delta — previous_total_cost_usd: null → no delta text", () => {
    const data: AgentPerformance = {
      ...FIXTURE,
      summary: {
        ...FIXTURE.summary,
        previous_total_cost_usd: null,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentPerformance).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);

    renderDashboard();

    // "vs last period" text must not appear when prev is null
    expect(screen.queryByText(/vs last period/i)).toBeNull();
    // No percentage arrows either (there may be accept-rate arrows, but not cost delta)
    // We check the total-cost card does NOT show delta — the specific "vs last period" string
    // is unique to cost delta; accept-rate sparkline uses a different pattern.
  });
});
