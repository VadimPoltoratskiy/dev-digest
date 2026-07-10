import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalRunRecord, EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

vi.mock("../../../../lib/hooks/agents-eval", () => ({
  useEvalsDashboard: vi.fn(),
}));

import { useEvalsDashboard } from "../../../../lib/hooks/agents-eval";
import { EvalsDashboard } from "./EvalsDashboard";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

    // Metric values rendered as large text (fmtPct)
    // recall=0.75 → "75.0%", precision=0.88 → "88.0%", citation=0.95 → "95.0%"
    const metricValues = screen.getAllByText("75.0%");
    expect(metricValues.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("88.0%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("95.0%").length).toBeGreaterThanOrEqual(1);
  });

  it("renders delta values with sign in the metric cards", () => {
    vi.mocked(useEvalsDashboard).mockReturnValue({
      data: DASHBOARD_DATA,
      isLoading: false,
      isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

    renderWithIntl(<EvalsDashboard />);

    // delta.recall=0.1 → "+10.0%"
    expect(screen.getByText("+10.0%")).toBeInTheDocument();
    // delta.precision=-0.05 → "-5.0%"
    expect(screen.getByText("-5.0%")).toBeInTheDocument();
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
