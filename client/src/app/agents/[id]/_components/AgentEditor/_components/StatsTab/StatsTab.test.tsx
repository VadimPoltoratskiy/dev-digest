import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentStats } from "@devdigest/shared";
// 8 hops from StatsTab/ to client/ → then messages/en/agents.json
import messages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock next/navigation before importing the component
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock useAgentStats hook before importing the component
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/performance", () => ({
  useAgentStats: vi.fn(),
}));

import { useSearchParams, useRouter } from "next/navigation";
import { useAgentStats } from "@/lib/hooks/performance";
import { StatsTab } from "./StatsTab";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ZERO_STATS: AgentStats = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  runs: 0,
  findings_total: 0,
  accepted: 0,
  dismissed: 0,
  pending: 0,
  accept_rate: null,
  dismiss_rate: null,
  avg_findings_per_run: null,
  total_cost_usd: null,
  avg_cost_usd: null,
  avg_latency_ms: null,
  findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
  trend: [],
};

const DATA_STATS: AgentStats = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  runs: 10,
  findings_total: 25,
  accepted: 9,
  dismissed: 3,
  pending: 13,
  accept_rate: 0.75,
  dismiss_rate: 0.25,
  avg_findings_per_run: 2.5,
  total_cost_usd: 0.0123,
  avg_cost_usd: 0.00123,
  avg_latency_ms: 1500,
  findings_by_severity: { CRITICAL: 5, WARNING: 12, SUGGESTION: 8 },
  trend: [
    { label: "2026-07-01T00:00:00.000Z", value: 3 },
    { label: "2026-07-02T00:00:00.000Z", value: 5 },
    { label: "2026-07-03T00:00:00.000Z", value: 2 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_REPLACE = vi.fn();

/** Build a minimal URLSearchParams-like mock. */
function mockSearchParams(overrides: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries({ period: "30d", ...overrides }));
  return {
    get: (key: string) => map.get(key) ?? null,
    toString: () =>
      Array.from(map.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("&"),
  };
}

function setupNavMocks(searchOverrides: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useSearchParams).mockReturnValue(mockSearchParams(searchOverrides) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRouter).mockReturnValue({ replace: MOCK_REPLACE } as any);
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <StatsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  MOCK_REPLACE.mockClear();
  setupNavMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatsTab — loading state", () => {
  it("renders skeleton tiles and no metric values while isLoading", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: undefined, isLoading: true, isError: false } as any);

    renderTab();

    // No metric values should be present
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
    expect(screen.queryByText("75.0%")).not.toBeInTheDocument();
    // Skeleton renders (at least one). We check the period preset buttons are present
    // (they render regardless of loading) to confirm the component mounted.
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });
});

describe("StatsTab — error state", () => {
  it("renders ErrorState and no metric values when isError", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: undefined, isLoading: false, isError: true } as any);

    renderTab();

    // ErrorState body text should be visible
    expect(screen.getByText("Could not load agent stats.")).toBeInTheDocument();
    // No metric values
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("StatsTab — zero-run agent (AC-16)", () => {
  it("renders '—' for accept_rate (not '0%') when runs === 0", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: ZERO_STATS, isLoading: false, isError: false } as any);

    renderTab();

    // Metric labels render
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Accept rate")).toBeInTheDocument();

    // "—" shown for null accept_rate — rendered by MetricCard as text
    // Multiple "—" placeholders appear (accept rate, dismiss rate, cost, etc.)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);

    // Must NOT show "0%"
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    // Empty state message shows
    expect(screen.getByText("No runs in this period.")).toBeInTheDocument();
  });
});

describe("StatsTab — data state", () => {
  it("renders accept_rate as a percentage string when non-null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: DATA_STATS, isLoading: false, isError: false } as any);

    renderTab();

    // Accept rate = 0.75 → "75.0%"
    expect(screen.getByText("75.0%")).toBeInTheDocument();

    // Key metric labels
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Findings")).toBeInTheDocument();
    expect(screen.getByText("Accept rate")).toBeInTheDocument();

    // Severity breakdown renders
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();

    // Trend section heading renders
    expect(screen.getByText("Recent runs (findings per run)")).toBeInTheDocument();

    // Trend chart has aria-label
    const trendImg = screen.getByRole("img");
    expect(trendImg).toHaveAttribute("aria-label");
    expect(trendImg.getAttribute("aria-label")).toContain("Recent runs");
  });
});

describe("StatsTab — period selector", () => {
  it("calls router.replace with period=7d in the URL when Last 7 days button is clicked", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: DATA_STATS, isLoading: false, isError: false } as any);

    renderTab();

    const btn7d = screen.getByText("Last 7 days");
    fireEvent.click(btn7d);

    expect(MOCK_REPLACE).toHaveBeenCalledOnce();
    const calledUrl = MOCK_REPLACE.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("period=7d");
    expect(calledUrl).toContain("/agents/ag1");
  });

  it("calls router.replace with period=1d when Last 24 hours is clicked", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentStats).mockReturnValue({ data: DATA_STATS, isLoading: false, isError: false } as any);

    renderTab();

    fireEvent.click(screen.getByText("Last 24 hours"));

    const calledUrl = MOCK_REPLACE.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("period=1d");
  });
});
