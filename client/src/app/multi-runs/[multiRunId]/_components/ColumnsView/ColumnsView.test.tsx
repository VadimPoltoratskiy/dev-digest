/**
 * Unit tests for ColumnsView component (SPEC-03 AC-8).
 *
 * Test intentions:
 * 1. ColumnsView
 *    - happy path: renders one column per agent (agent name visible)
 *    - live status: running agent's accessible text label "Running" is in DOM (not icon-only)
 *    - "View trace" callback: clicking "View trace" triggers onViewTrace with correct runId + agentName
 *    - "Unknown agent" fallback: when agent_name is null, the i18n fallback key is rendered
 *    - mocks needed: next-intl (via NextIntlClientProvider), no network calls
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentRunSummary, MultiRunFindings } from "@devdigest/shared";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import { ColumnsView } from "./ColumnsView";

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
  finding_count: 2,
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
  finding_count: 0,
  cost_usd: 0.005,
  duration_ms: 4000,
  error: null,
};

const RUNNING: AgentRunSummary = {
  run_id: "run-running",
  agent_id: "agent-3",
  agent_name: "Gamma",
  status: "running",
  score: null,
  finding_count: null,
  cost_usd: undefined,
  duration_ms: undefined,
  error: null,
};

const NULL_NAME: AgentRunSummary = {
  run_id: "run-null",
  agent_id: null,
  agent_name: null,
  status: "done",
  score: null,
  finding_count: null,
  cost_usd: undefined,
  duration_ms: undefined,
  error: null,
};

const EMPTY_FINDINGS: MultiRunFindings["agents"] = [];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderColumnsView(props: {
  agents?: AgentRunSummary[];
  agentFindings?: MultiRunFindings["agents"];
  sseStatuses?: Record<string, string>;
  onViewTrace?: (runId: string, agentName: string | null) => void;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiRuns: multiRunsMessages }}>
      <ColumnsView
        agents={props.agents ?? [ALPHA, BETA]}
        agentFindings={props.agentFindings ?? EMPTY_FINDINGS}
        sseStatuses={props.sseStatuses ?? {}}
        onViewTrace={props.onViewTrace ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColumnsView", () => {
  it("renders one column per agent with the agent name visible", () => {
    renderColumnsView({ agents: [ALPHA, BETA] });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // Two "View trace" buttons — one per column
    expect(screen.getAllByRole("button", { name: "View trace" })).toHaveLength(2);
  });

  it("displays live accessible status text for a running agent (AC-8 accessibility)", () => {
    renderColumnsView({ agents: [RUNNING] });

    // The status text must be readable as text (not icon-only)
    const runningLabels = screen.getAllByLabelText("Running");
    expect(runningLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onViewTrace with the correct runId and agentName when 'View trace' is clicked", () => {
    const onViewTrace = vi.fn();
    renderColumnsView({ agents: [ALPHA, BETA], onViewTrace });

    const buttons = screen.getAllByRole("button", { name: "View trace" });
    // First button corresponds to ALPHA (first agent)
    fireEvent.click(buttons[0]!);
    expect(onViewTrace).toHaveBeenCalledWith("run-alpha", "Alpha");

    // Second button corresponds to BETA
    fireEvent.click(buttons[1]!);
    expect(onViewTrace).toHaveBeenCalledWith("run-beta", "Beta");
  });

  it("renders the 'Unknown agent' fallback when agent_name is null", () => {
    renderColumnsView({ agents: [NULL_NAME] });

    // The i18n key "results.unknownAgent" maps to "Unknown agent"
    expect(screen.getByText("Unknown agent")).toBeInTheDocument();
  });

  it("renders finding items when agentFindings is provided", () => {
    const agentFindings: MultiRunFindings["agents"] = [
      {
        agent_id: "agent-1",
        agent_name: "Alpha",
        findings: [
          {
            id: "f1",
            severity: "CRITICAL",
            category: "security",
            title: "SQL injection risk",
            file: "src/db.ts",
            start_line: 10,
            end_line: 12,
            rationale: "Unsanitized input.",
            suggestion: null,
            confidence: 0.9,
            kind: "finding",
            trifecta_components: null,
            evidence: null,
            review_id: "rev1",
            accepted_at: null,
            dismissed_at: null,
          },
        ],
      },
    ];

    renderColumnsView({ agents: [ALPHA], agentFindings });

    // Finding item title should appear in the column
    expect(screen.getByText(/SQL injection risk/)).toBeInTheDocument();
  });
});
