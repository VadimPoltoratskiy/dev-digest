import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiRunRecord, MultiRunFindings, FindingRecord } from "@devdigest/shared";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import runsMessages from "../../../../../../messages/en/runs.json";

// ---------------------------------------------------------------------------
// Mock hooks and drawer
// ---------------------------------------------------------------------------

vi.mock("../../../../../lib/hooks/multi-runs", () => ({
  useMultiRun: vi.fn(),
  useMultiRunFindings: vi.fn(),
}));

vi.mock("../../../../../lib/hooks/reviews", () => ({
  useRunEvents: vi.fn(),
}));

// Mock RunTraceDrawer: renders a div with a data attribute so tests can
// verify the runId without needing a full drawer setup.
vi.mock("../../../../../components/RunTraceDrawer", () => ({
  default: ({
    runId,
    onClose,
  }: {
    runId: string;
    onClose: () => void;
  }) => (
    <div data-testid="run-trace-drawer" data-run-id={runId}>
      <button type="button" onClick={onClose}>
        Close drawer
      </button>
    </div>
  ),
}));

import { useMultiRun, useMultiRunFindings } from "../../../../../lib/hooks/multi-runs";
import { useRunEvents } from "../../../../../lib/hooks/reviews";
import { MultiRunResultsView } from "./MultiRunResultsView";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FINDING_A: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "SQL injection risk",
  file: "src/db.ts",
  start_line: 10,
  end_line: 12,
  rationale: "User input is interpolated into a SQL string.",
  suggestion: "Use parameterized queries.",
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rev1",
  accepted_at: null,
  dismissed_at: null,
};

const AGENT_ALPHA = {
  run_id: "run-alpha",
  agent_id: "agent-1",
  agent_name: "Alpha",
  status: "done" as const,
  score: 82,
  finding_count: 1,
  cost_usd: 0.002,
  duration_ms: 4000,
  error: null,
};

const AGENT_BETA = {
  run_id: "run-beta",
  agent_id: "agent-2",
  agent_name: "Beta",
  status: "done" as const,
  score: 75,
  finding_count: 1,
  cost_usd: 0.003,
  duration_ms: 5000,
  error: null,
};

const MULTI_RUN: MultiRunRecord = {
  id: "mr1",
  pr_id: "pr1",
  pr_number: 42,
  ran_at: "2026-07-01T12:00:00.000Z",
  agents: [AGENT_ALPHA, AGENT_BETA],
  total_cost_usd: 0.005,
  total_duration_ms: 5000,
};

const MULTI_RUN_FINDINGS: MultiRunFindings = {
  agents: [
    { agent_id: "agent-1", agent_name: "Alpha", findings: [FINDING_A] },
    { agent_id: "agent-2", agent_name: "Beta", findings: [FINDING_A] },
  ],
  groups: [
    {
      file: "src/db.ts",
      start_line: 10,
      end_line: 12,
      agent_verdicts: [
        { agent_id: "agent-1", agent_name: "Alpha", finding: FINDING_A },
        { agent_id: "agent-2", agent_name: "Beta", finding: FINDING_A },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderView(multiRunId = "mr1") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          multiRuns: multiRunsMessages,
          prReview: prReviewMessages,
          eval: evalMessages,
          runs: runsMessages,
        }}
      >
        <MultiRunResultsView multiRunId={multiRunId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// Default happy-path setup
function setupMocks(
  runOverrides: Partial<MultiRunRecord> = {},
  findingsOverrides: Partial<MultiRunFindings> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useMultiRun).mockReturnValue({
    data: { ...MULTI_RUN, ...runOverrides },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useMultiRunFindings).mockReturnValue({
    data: { ...MULTI_RUN_FINDINGS, ...findingsOverrides },
    isLoading: false,
    isError: false,
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRunEvents).mockReturnValue({ events: [], running: false } as any);
}

beforeEach(() => {
  setupMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiRunResultsView", () => {
  it("renders Columns mode with 2 agent columns", () => {
    renderView();
    // Both agent names appear in the columns
    expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Beta").length).toBeGreaterThanOrEqual(1);
    // Two "View trace" buttons — one per column
    expect(screen.getAllByRole("button", { name: "View trace" })).toHaveLength(2);
  });

  it("toggles to Tabs mode and renders agent tabs", () => {
    renderView();
    // Click the Tabs toggle button
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    // Now tabs are rendered
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // Non-null assertions: we've verified length === 2 above.
    expect(tabs[0]!).toHaveTextContent("Alpha");
    expect(tabs[1]!).toHaveTextContent("Beta");
  });

  it("opens RunTraceDrawer for agent A when View trace is clicked", () => {
    renderView();
    const buttons = screen.getAllByRole("button", { name: "View trace" });
    fireEvent.click(buttons[0]!);
    const drawer = screen.getByTestId("run-trace-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("data-run-id", "run-alpha");
  });

  it("changes RunTraceDrawer runId when View trace for agent B is clicked", () => {
    renderView();
    const buttons = screen.getAllByRole("button", { name: "View trace" });
    // Open alpha first
    fireEvent.click(buttons[0]!);
    expect(screen.getByTestId("run-trace-drawer")).toHaveAttribute(
      "data-run-id",
      "run-alpha",
    );
    // Close and open beta (buttons shift after drawer opens — get fresh)
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    const buttonsAfter = screen.getAllByRole("button", { name: "View trace" });
    fireEvent.click(buttonsAfter[1]!);
    expect(screen.getByTestId("run-trace-drawer")).toHaveAttribute(
      "data-run-id",
      "run-beta",
    );
  });

  it("hides a consensus group when showOnlyConflicts is toggled on", () => {
    // Both agents have the same severity (CRITICAL) → not a conflict
    renderView();
    // The conflict group header should be visible initially
    expect(screen.getByText(/src\/db\.ts — lines/)).toBeInTheDocument();
    // Toggle "Show only conflicts"
    const toggleBtn = screen.getByRole("switch", {
      name: "Show only conflicts",
    });
    fireEvent.click(toggleBtn);
    // Now the group row should be hidden (all agents agree, so isConflict = false)
    expect(screen.queryByText(/src\/db\.ts — lines/)).not.toBeInTheDocument();
  });

  it('shows "Running" status when an agent has status=running', () => {
    setupMocks({
      agents: [
        { ...AGENT_ALPHA, status: "running" },
        AGENT_BETA,
      ],
    });
    renderView();
    // The running agent's accessible label should appear
    expect(screen.getAllByLabelText("Running").length).toBeGreaterThanOrEqual(1);
  });

  it("renders all-failed state without an error boundary", () => {
    setupMocks({
      agents: [
        { ...AGENT_ALPHA, status: "failed", error: "LLM timeout" },
        { ...AGENT_BETA, status: "failed", error: "Rate limited" },
      ],
    });
    // No findings for failed runs
    setupMocks(
      {
        agents: [
          { ...AGENT_ALPHA, status: "failed", error: "LLM timeout" },
          { ...AGENT_BETA, status: "failed", error: "Rate limited" },
        ],
      },
      {
        agents: [
          { agent_id: "agent-1", agent_name: "Alpha", findings: [] },
          { agent_id: "agent-2", agent_name: "Beta", findings: [] },
        ],
        groups: [],
      },
    );
    renderView();
    // Both failed indicators should appear
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    // No trace drawer or error boundary — page still renders
    expect(screen.queryByTestId("run-trace-drawer")).not.toBeInTheDocument();
  });
});
