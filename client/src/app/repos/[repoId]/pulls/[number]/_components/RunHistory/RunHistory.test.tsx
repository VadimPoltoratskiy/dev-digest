/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 *
 * Test intentions (added tests):
 * 3. RunHistory with findingsByRun prop
 *    - happy path: settled "done" run + findingsByRun Map with [CRITICAL, CRITICAL, WARNING]
 *      findings for that run → FindingsCounter renders severity badges "2" and "1"
 *      alongside the existing "N finding(s)" text
 *    - boundary: usePrReviews must be mocked so FindingsCounter (per-run mode) renders
 *      without a QueryClientProvider; the hook is called with null and stays inert
 *    - mocks needed: usePrReviews (returns { data: undefined, isLoading: false })
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

// FindingsCounter (rendered when findingsByRun is provided) calls usePrReviews
// internally. In per-run mode it passes null, so the hook is inert, but TanStack
// Query still requires a QueryClientProvider unless the hook is mocked. Mock it
// here so the new test needs no provider wrapper.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

/** Minimal valid FindingRecord for test fixtures. */
function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f-1",
    severity: "CRITICAL",
    category: "bug",
    title: "Test finding title",
    file: "src/index.ts",
    start_line: 1,
    end_line: 5,
    rationale: "This is a test rationale.",
    confidence: 0.9,
    review_id: "review-1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function renderRunsWithFindings(runs: RunSummary[], findingsByRun: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} findingsByRun={findingsByRun} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders FindingsCounter severity badges alongside the findings text when findingsByRun is provided", () => {
    const findings: FindingRecord[] = [
      makeFinding({ id: "f-1", severity: "CRITICAL" }),
      makeFinding({ id: "f-2", severity: "CRITICAL" }),
      makeFinding({ id: "f-3", severity: "WARNING" }),
    ];
    // Map run-1 to findings so FindingsCounter gets them in per-run mode
    const findingsByRun = new Map<string, FindingRecord[]>([["run-1", findings]]);

    renderRunsWithFindings(
      [run({ status: "done", findings_count: 3, blockers: 0, score: null })],
      findingsByRun,
    );

    // The existing "N finding(s)" text is still present
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();

    // FindingsCounter derives CRITICAL=2, WARNING=1 from the provided findings:
    // badge "2" for CRITICAL, badge "1" for WARNING
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
