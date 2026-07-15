/**
 * Unit tests for TabsView component (SPEC-03 AC-9).
 *
 * Test intentions:
 * 1. TabsView
 *    - tab bar accessibility: role="tablist" with role="tab" children
 *    - first tab is aria-selected initially; others are not
 *    - clicking a different tab makes it aria-selected
 *    - switching tabs changes displayed content (agent name + findings)
 *    - FindingCard renders in active tab with Accept/Dismiss actions present (AC-11)
 *    - "View trace" button in the summary card triggers onViewTrace with correct args
 *    - running agent: tab label includes accessible "Running" text
 *    - mocks needed: next-intl (via NextIntlClientProvider), prReview messages for FindingCard
 *
 * Additional wiring tests (post-fix — onAction/onCreateEvalCase/pending props):
 * 2. onAction — Accept wiring: mutate called with findingId, action, prId, local onSuccess
 * 3. onAction — Dismiss wiring: mutate called with action: "dismiss"
 * 4. pending=true disables Accept + Dismiss buttons
 * 5. onSuccess callback invalidates ["multi-run-findings", multiRunId] on the QueryClient
 * 6. onCreateEvalCase wiring: modal submit calls createEvalCase.mutate with correct args
 * 7. evalCasePending=true disables the "Turn into eval case" button
 * 8. null repoFullName/headSha (not-yet-loaded state): no crash, no GitHub link rendered
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentRunSummary, MultiRunFindings } from "@devdigest/shared";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../messages/en/eval.json";

const {
  mockActionMutate,
  mockIsPendingRef,
  mockCreateEvalMutate,
  mockEvalIsPendingRef,
  mockActiveRepoRef,
  mockPullDetailRef,
} = vi.hoisted(() => ({
  mockActionMutate: vi.fn(),
  mockIsPendingRef: { current: false } as { current: boolean },
  mockCreateEvalMutate: vi.fn(),
  mockEvalIsPendingRef: { current: false } as { current: boolean },
  mockActiveRepoRef: { current: { full_name: "acme/test-repo" } } as {
    current: { full_name: string } | null;
  },
  mockPullDetailRef: { current: { head_sha: "sha-abc123" } } as {
    current: { head_sha: string } | null;
  },
}));

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({
    mutate: mockActionMutate,
    isPending: mockIsPendingRef.current,
  }),
}));

vi.mock("@/lib/hooks/agents-eval", () => ({
  useTurnFindingIntoEvalCase: () => ({
    mutate: mockCreateEvalMutate,
    isPending: mockEvalIsPendingRef.current,
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: mockActiveRepoRef.current }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: mockPullDetailRef.current }),
}));

import { TabsView } from "./TabsView";

afterEach(() => {
  cleanup();
  mockActionMutate.mockClear();
  mockCreateEvalMutate.mockClear();
  mockIsPendingRef.current = false;
  mockEvalIsPendingRef.current = false;
  mockActiveRepoRef.current = { full_name: "acme/test-repo" };
  mockPullDetailRef.current = { head_sha: "sha-abc123" };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALPHA: AgentRunSummary = {
  run_id: "run-alpha",
  agent_id: "agent-1",
  agent_name: "Alpha",
  status: "done",
  score: 82,
  finding_count: 1,
  cost_usd: 0.01,
  duration_ms: 3000,
  error: null,
};

const BETA: AgentRunSummary = {
  run_id: "run-beta",
  agent_id: "agent-2",
  agent_name: "Beta",
  status: "done",
  score: 75,
  finding_count: 1,
  cost_usd: 0.005,
  duration_ms: 5000,
  error: null,
};

const RUNNING: AgentRunSummary = {
  run_id: "run-gamma",
  agent_id: "agent-3",
  agent_name: "Gamma",
  status: "running",
  score: null,
  finding_count: null,
  cost_usd: undefined,
  duration_ms: undefined,
  error: null,
};

const FINDING_ALPHA = {
  id: "f-alpha",
  severity: "CRITICAL" as const,
  category: "security" as const,
  title: "SQL injection in Alpha",
  file: "src/alpha.ts",
  start_line: 10,
  end_line: 12,
  rationale: "User input not sanitized.",
  suggestion: null,
  confidence: 0.9,
  kind: "finding" as const,
  trifecta_components: null,
  evidence: null,
  review_id: "rev-alpha",
  accepted_at: null,
  dismissed_at: null,
};

const FINDING_BETA = {
  id: "f-beta",
  severity: "WARNING" as const,
  category: "perf" as const,
  title: "N+1 query in Beta",
  file: "src/beta.ts",
  start_line: 20,
  end_line: 22,
  rationale: "DB query in loop.",
  suggestion: null,
  confidence: 0.8,
  kind: "finding" as const,
  trifecta_components: null,
  evidence: null,
  review_id: "rev-beta",
  accepted_at: null,
  dismissed_at: null,
};

/** An accepted finding — shows the "Turn into eval case" button when the card is expanded. */
const FINDING_ACCEPTED = {
  ...FINDING_ALPHA,
  id: "f-accepted",
  title: "SQL injection accepted",
  accepted_at: "2026-01-01T00:00:00.000Z",
};

const AGENT_FINDINGS: MultiRunFindings["agents"] = [
  { agent_id: "agent-1", agent_name: "Alpha", findings: [FINDING_ALPHA] },
  { agent_id: "agent-2", agent_name: "Beta", findings: [FINDING_BETA] },
];

/** Agent findings for accepted-finding wiring tests (eval case button visible). */
const AGENT_FINDINGS_ACCEPTED: MultiRunFindings["agents"] = [
  { agent_id: "agent-1", agent_name: "Alpha", findings: [FINDING_ACCEPTED] },
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTabsView(props: {
  agents?: AgentRunSummary[];
  agentFindings?: MultiRunFindings["agents"];
  sseStatuses?: Record<string, string>;
  onViewTrace?: (runId: string, agentName: string | null) => void;
  prId?: string;
  multiRunId?: string;
  queryClient?: QueryClient;
}) {
  const qc = props.queryClient ?? new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          multiRuns: multiRunsMessages,
          prReview: prReviewMessages,
          eval: evalMessages,
        }}
      >
        <TabsView
          agents={props.agents ?? [ALPHA, BETA]}
          agentFindings={props.agentFindings ?? AGENT_FINDINGS}
          sseStatuses={props.sseStatuses ?? {}}
          onViewTrace={props.onViewTrace ?? vi.fn()}
          prId={props.prId ?? "pr-test"}
          multiRunId={props.multiRunId ?? "mr-test"}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TabsView", () => {
  it("renders a tab bar with role='tablist' and one role='tab' per agent", () => {
    renderTabsView({});

    const tabList = screen.getByRole("tablist");
    expect(tabList).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!).toHaveTextContent("Alpha");
    expect(tabs[1]!).toHaveTextContent("Beta");
  });

  it("first tab is aria-selected initially; second is not", () => {
    renderTabsView({});

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]!).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]!).toHaveAttribute("aria-selected", "false");
  });

  it("clicking the second tab makes it aria-selected and shows Beta's content", () => {
    renderTabsView({});

    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]!);

    // Now Beta's tab is selected
    expect(tabs[1]!).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]!).toHaveAttribute("aria-selected", "false");
  });

  it("switching tabs changes the displayed findings (Alpha finding → Beta finding)", () => {
    renderTabsView({});

    // Initially Alpha's finding is visible
    expect(screen.getByText("SQL injection in Alpha")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query in Beta")).not.toBeInTheDocument();

    // Switch to Beta
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]!);

    // Beta's finding should now be visible
    expect(screen.getByText("N+1 query in Beta")).toBeInTheDocument();
    expect(screen.queryByText("SQL injection in Alpha")).not.toBeInTheDocument();
  });

  it("FindingCard renders Accept and Dismiss actions for the active tab's findings (AC-11)", () => {
    renderTabsView({});

    // FindingCard is rendered with defaultExpanded={false} in TabsView.
    // The card shows Accept/Dismiss action buttons.
    // We need to expand the card first.
    const card = screen.getByText("SQL injection in Alpha");
    fireEvent.click(card.closest("div")!);

    // After expanding, Accept and Dismiss buttons should be present
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("'View trace' button in summary card calls onViewTrace with correct runId and agentName", () => {
    const onViewTrace = vi.fn();
    renderTabsView({ onViewTrace });

    // Active tab is Alpha initially
    const viewTraceBtn = screen.getByRole("button", { name: "View trace" });
    fireEvent.click(viewTraceBtn);

    expect(onViewTrace).toHaveBeenCalledWith("run-alpha", "Alpha");
  });

  it("running agent tab label includes accessible 'Running' text", () => {
    renderTabsView({ agents: [ALPHA, RUNNING], agentFindings: [] });

    const tabs = screen.getAllByRole("tab");
    // Gamma (running) should have an accessible running label within its tab
    const runningTab = tabs.find((t) => t.textContent?.includes("Gamma"));
    expect(runningTab).toBeDefined();
    const runningLabel = runningTab!.querySelector("[aria-label='Running']");
    expect(runningLabel).not.toBeNull();
  });

  it("returns null when agents is empty", () => {
    const { container } = renderTabsView({ agents: [], agentFindings: [] });
    // No tablist or content rendered
    expect(container.firstChild).toBeNull();
  });

  it("wires onAction: clicking Accept on an expanded card calls action.mutate with findingId, action, prId, and local onSuccess", () => {
    renderTabsView({});

    // Expand the first finding card
    fireEvent.click(screen.getByText("SQL injection in Alpha").closest("div")!);

    // Click Accept
    fireEvent.click(screen.getByText("Accept"));

    expect(mockActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: "f-alpha",
        action: "accept",
        prId: "pr-test",
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("FindingCard file:line renders as a link when repoFullName and headSha are available", () => {
    renderTabsView({});

    // useActiveRepo returns { full_name: "acme/test-repo" }
    // usePullDetail returns { head_sha: "sha-abc123" }
    // FindingCard builds a githubBlobUrl and MonoLink renders it as <a href=...>
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href")?.includes("acme/test-repo"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // NEW: coverage for the onAction / onCreateEvalCase / pending wiring fix
  // ---------------------------------------------------------------------------

  it("Dismiss action calls action.mutate with action: 'dismiss', correct findingId, prId, and local onSuccess", () => {
    renderTabsView({});

    fireEvent.click(screen.getByText("SQL injection in Alpha").closest("div")!);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(mockActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: "f-alpha",
        action: "dismiss",
        prId: "pr-test",
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("Accept and Dismiss buttons are disabled while action.isPending is true", () => {
    mockIsPendingRef.current = true;
    renderTabsView({});

    fireEvent.click(screen.getByText("SQL injection in Alpha").closest("div")!);

    expect(screen.getByRole("button", { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeDisabled();
  });

  it("onSuccess callback invalidates the ['multi-run-findings', multiRunId] query key on the QueryClient", () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    renderTabsView({ queryClient: qc, multiRunId: "mr-42" });

    fireEvent.click(screen.getByText("SQL injection in Alpha").closest("div")!);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    expect(mockActionMutate).toHaveBeenCalledOnce();
    const [, opts] = mockActionMutate.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];

    // Invoke the callback directly — it should invalidate the multi-run-findings cache
    opts.onSuccess();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["multi-run-findings", "mr-42"],
    });
  });

  it("onCreateEvalCase: saving the eval case modal for an accepted finding calls createEvalCase.mutate with the correct args", () => {
    renderTabsView({ agents: [ALPHA], agentFindings: AGENT_FINDINGS_ACCEPTED });

    // Expand the accepted finding card
    fireEvent.click(screen.getByText("SQL injection accepted").closest("div")!);

    // Open the eval case modal — button is only visible for muted (accepted/dismissed) findings
    fireEvent.click(
      screen.getByRole("button", { name: /turn into eval case/i }),
    );

    // Submit the modal with default values (name = title, kind = "must_find" for accepted)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mockCreateEvalMutate).toHaveBeenCalledWith({
      findingId: "f-accepted",
      kind: "must_find",
      name: "SQL injection accepted",
    });
  });

  it("evalCasePending=true disables the 'Turn into eval case' button while a mutation is in-flight", () => {
    mockEvalIsPendingRef.current = true;
    renderTabsView({ agents: [ALPHA], agentFindings: AGENT_FINDINGS_ACCEPTED });

    fireEvent.click(screen.getByText("SQL injection accepted").closest("div")!);

    expect(
      screen.getByRole("button", { name: /turn into eval case/i }),
    ).toBeDisabled();
  });

  it("renders without crashing and shows no GitHub link when repoFullName and headSha are not yet loaded", () => {
    mockActiveRepoRef.current = null;
    mockPullDetailRef.current = null;

    renderTabsView({});

    // Tab bar still renders — component did not crash
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    // With no fileHref, MonoLink renders as a <button> instead of <a>,
    // so no link elements should be present in the document
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
