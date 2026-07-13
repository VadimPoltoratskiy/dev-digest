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
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentRunSummary, MultiRunFindings } from "@devdigest/shared";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import { TabsView } from "./TabsView";

afterEach(cleanup);

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

const AGENT_FINDINGS: MultiRunFindings["agents"] = [
  { agent_id: "agent-1", agent_name: "Alpha", findings: [FINDING_ALPHA] },
  { agent_id: "agent-2", agent_name: "Beta", findings: [FINDING_BETA] },
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTabsView(props: {
  agents?: AgentRunSummary[];
  agentFindings?: MultiRunFindings["agents"];
  sseStatuses?: Record<string, string>;
  onViewTrace?: (runId: string, agentName: string | null) => void;
}) {
  return render(
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
      />
    </NextIntlClientProvider>,
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
});
