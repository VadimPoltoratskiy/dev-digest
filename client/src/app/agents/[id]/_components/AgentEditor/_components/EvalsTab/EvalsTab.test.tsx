import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalCase, AgentEvalCompare } from "@devdigest/shared";
import type { EvalRunRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";

// Mock the agents-eval sub-module before importing the component.
// vi.mock is hoisted so it runs before imports.
vi.mock("../../../../../../../lib/hooks/agents-eval", () => ({
  useAgentEvalCases: vi.fn(),
  useDeleteAgentEvalCase: vi.fn(),
  useRunAgentEvalBatch: vi.fn(),
  useAgentEvalRuns: vi.fn(),
  useAgentEvalRunsCompare: vi.fn(),
}));

import {
  useAgentEvalCases,
  useDeleteAgentEvalCase,
  useRunAgentEvalBatch,
  useAgentEvalRuns,
  useAgentEvalRunsCompare,
} from "../../../../../../../lib/hooks/agents-eval";
import { EvalsTab } from "./EvalsTab";

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

/** Default sane mock return values — override per test as needed. */
function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentEvalCases).mockReturnValue({ data: [], isLoading: false, isError: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDeleteAgentEvalCase).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRunAgentEvalBatch).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentEvalRuns).mockReturnValue({ data: [] } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: undefined, isLoading: false, isError: false } as any);
}

beforeEach(setupDefaultMocks);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_MUST_FIND: AgentEvalCase = {
  id: "c1",
  agent_id: "ag1",
  name: "Must find stripe key",
  notes: null,
  input_diff: "diff...",
  expected_output: {
    kind: "must_find",
    finding: { file: "src/config.ts", start_line: 11, end_line: 11, title: "Secret", severity: "CRITICAL", category: "security" },
  },
  latest_run: { pass: true, ran_at: "2026-07-01T10:00:00.000Z" },
};

const CASE_MUST_NOT_FLAG: AgentEvalCase = {
  id: "c2",
  agent_id: "ag1",
  name: "Must not flag other.ts",
  notes: null,
  input_diff: "diff...",
  expected_output: {
    kind: "must_not_flag",
    finding: { file: "src/other.ts", start_line: 1, end_line: 1, title: "False positive", severity: "WARNING", category: "style" },
  },
  latest_run: { pass: false, ran_at: "2026-07-01T10:00:00.000Z" },
};

const CASE_NEVER_RUN: AgentEvalCase = {
  id: "c3",
  agent_id: "ag1",
  name: "Never-run case",
  notes: null,
  input_diff: "diff...",
  expected_output: {
    kind: "must_find",
    finding: { file: "src/config.ts", start_line: 5, end_line: 5, title: "Something", severity: "WARNING", category: "bug" },
  },
  latest_run: null,
};

const RUN_A: EvalRunRecord = {
  id: "r1",
  case_id: "c1",
  case_name: "Must find stripe key",
  ran_at: "2026-07-01T10:00:00.000Z",
  actual_output: null,
  pass: true,
  recall: 1.0,
  precision: 1.0,
  citation_accuracy: 0.5,
  duration_ms: 100,
  cost_usd: 0.001,
};

const RUN_B: EvalRunRecord = {
  id: "r2",
  case_id: "c1",
  case_name: "Must find stripe key",
  ran_at: "2026-07-02T10:00:00.000Z",
  actual_output: null,
  pass: false,
  recall: 0.5,
  precision: 0.8,
  citation_accuracy: 0.3,
  duration_ms: 150,
  cost_usd: 0.002,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalsTab — case list", () => {
  it("renders KindBadge with kind text and CaseStatusIcon aria-label Passed for a passed must_find case", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalCases).mockReturnValue({ data: [CASE_MUST_FIND], isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    expect(screen.getByText("Must find")).toBeInTheDocument();
    expect(screen.getByText("Must find stripe key")).toBeInTheDocument();
    expect(screen.getByLabelText("Passed")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
  });

  it("renders KindBadge and CaseStatusIcon aria-label Failed for a failed must_not_flag case", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalCases).mockReturnValue({ data: [CASE_MUST_NOT_FLAG], isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    expect(screen.getByText("Must not flag")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows 'never run' label and Never-run aria-label when latest_run is null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalCases).mockReturnValue({ data: [CASE_NEVER_RUN], isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByLabelText("Never run")).toBeInTheDocument();
  });
});

describe("EvalsTab — run all button", () => {
  it("calls runBatch.mutate() when 'Run all evals' is clicked", () => {
    const mockMutate = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useRunAgentEvalBatch).mockReturnValue({ mutate: mockMutate, isPending: false } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    fireEvent.click(screen.getByText("Run all evals"));
    expect(mockMutate).toHaveBeenCalledOnce();
  });
});

describe("EvalsTab — run history and compare", () => {
  it("shows Compare button when two run history rows are selected and renders CompareView on click", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRuns).mockReturnValue({ data: [RUN_A, RUN_B] } as any);

    const compareData: AgentEvalCompare = {
      run_a: { ran_at: RUN_A.ran_at, recall: 1.0, precision: 1.0, citation_accuracy: 0.5, cost_usd: 0.001 },
      run_b: { ran_at: RUN_B.ran_at, recall: 0.5, precision: 0.8, citation_accuracy: 0.3, cost_usd: 0.002 },
      deltas: { recall: -0.5, precision: -0.2, citation_accuracy: -0.2, cost_usd: 0.001 },
      flips: [{ case_id: "c1", case_name: "My flip case", from_pass: true, to_pass: false }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: compareData, isLoading: false, isError: false } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    // Select both run history rows (role="checkbox")
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    // Compare button should now be visible
    const compareButton = screen.getByText("Compare");
    expect(compareButton).toBeInTheDocument();
    fireEvent.click(compareButton);

    // CompareView is shown
    expect(screen.getByText("Comparing runs")).toBeInTheDocument();
    expect(screen.getByText("Metric deltas")).toBeInTheDocument();
    // Delta recall = -0.5 → "-50.0%"
    expect(screen.getByText("-50.0%")).toBeInTheDocument();
    // Flips table
    expect(screen.getByText("Case flips")).toBeInTheDocument();
    expect(screen.getByText("My flip case")).toBeInTheDocument();
  });
});

describe("EvalsTab — null metrics display", () => {
  it("shows N/A for null recall, precision, citation_accuracy in run history", () => {
    const nullRun: EvalRunRecord = {
      ...RUN_A,
      recall: null,
      precision: null,
      citation_accuracy: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRuns).mockReturnValue({ data: [nullRun] } as any);

    renderWithIntl(<EvalsTab agentId="ag1" />);

    // All three metric cells should show "N/A"
    const naElements = screen.getAllByText("N/A");
    expect(naElements.length).toBeGreaterThanOrEqual(3);
  });
});
