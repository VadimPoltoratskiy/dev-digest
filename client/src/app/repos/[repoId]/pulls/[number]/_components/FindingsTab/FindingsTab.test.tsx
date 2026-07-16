/**
 * FindingsTab integration test — badge → accordion expand → scroll path.
 *
 * We pass findingTarget directly (simulating what page.tsx sets after a badge
 * click in the Diff tab) and assert that:
 *  1. The finding's accordion expands and the finding title is visible.
 *  2. scrollIntoView is called (after requestAnimationFrame).
 *
 * All TanStack Query hooks are fully mocked so no QueryClientProvider is needed.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { FindingsTab } from "./FindingsTab";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";

afterEach(cleanup);

// Fully mock all hooks so no query client is needed.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(() => ({ data: undefined, isLoading: false })),
  useCancelRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePrActiveRuns: vi.fn(() => ({ data: [] })),
  usePrRuns: vi.fn(() => ({ data: [] })),
  useDeleteRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteReview: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useFindingAction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRunEvents: vi.fn(() => ({ events: [], running: false })),
}));

vi.mock("@/lib/hooks/agents-eval", () => ({
  useTurnFindingIntoEvalCase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/lib/hooks/core", () => ({
  useSmartDiff: vi.fn(() => ({ data: undefined })),
}));

/** Minimal FindingRecord fixture. */
function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    review_id: "rev-1",
    severity: "CRITICAL",
    category: "bug",
    title: "Test finding title",
    file: "src/index.ts",
    start_line: 10,
    end_line: 10,
    rationale: "This is a bug.",
    suggestion: null,
    confidence: 0.9,
    kind: null,
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

/** Minimal ReviewRecord fixture with one finding. */
const finding = makeFinding();
const runs: ReviewRecord[] = [
  {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "TestAgent",
    kind: "review",
    verdict: "comment",
    summary: "Looks OK.",
    score: null,
    model: null,
    grounding: null,
    created_at: new Date().toISOString(),
    findings: [finding],
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const cancelMutationStub = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  isIdle: true,
  data: undefined,
  error: null,
  reset: vi.fn(),
  status: "idle" as const,
  variables: undefined,
  context: undefined,
  failureCount: 0,
  failureReason: null,
  submittedAt: 0,
};

describe("FindingsTab", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("expands the accordion and scrolls to the target finding when findingTarget is set", async () => {
    renderWithIntl(
      <FindingsTab
        prId="pr-1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={cancelMutationStub as any}
        findingTarget={{ id: "f1", n: 1 }}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
      />,
    );

    // The accordion is expanded (defaultOpen=true for first run, plus the effect fires).
    // The finding card with the title should be visible.
    expect(screen.getByText("Test finding title")).toBeInTheDocument();

    // scrollIntoView is called in a requestAnimationFrame callback.
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("does not call scrollIntoView when findingTarget is null", async () => {
    renderWithIntl(
      <FindingsTab
        prId="pr-1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={cancelMutationStub as any}
        findingTarget={null}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
      />,
    );

    // Accordion is open because it's the first run (defaultOpen=true).
    expect(screen.getByText("Test finding title")).toBeInTheDocument();
    // No scroll should happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
