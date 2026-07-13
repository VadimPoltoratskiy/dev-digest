/**
 * Unit tests for ConflictsSection component (SPEC-03 AC-12, AC-13).
 *
 * Test intentions:
 * 1. ConflictsSection
 *    - all groups shown initially when showOnlyConflicts is false
 *    - "Show only conflicts" toggle: role="switch" with aria-checked reflecting current state
 *    - clicking toggle calls onToggle callback
 *    - conflict rule: group with ≥2 distinct verdicts is shown when filter is active
 *    - conflict rule: null finding counts as "did_not_flag" — distinct from any severity
 *    - group with all-same verdicts is hidden when showOnlyConflicts is true
 *    - empty state: "requires at least two agents" note when groups=[] and allAgentCount < 2
 *    - mocks needed: next-intl (via NextIntlClientProvider)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingGroup } from "@devdigest/shared";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import { ConflictsSection } from "./ConflictsSection";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(severity: "CRITICAL" | "WARNING" | "SUGGESTION") {
  return {
    id: `f-${severity}`,
    severity,
    category: "security" as const,
    title: `${severity} issue`,
    file: "src/index.ts",
    start_line: 10,
    end_line: 12,
    rationale: "Rationale",
    suggestion: null,
    confidence: 0.9,
    kind: "finding" as const,
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
  };
}

/** Group where all agents have the same verdict (both CRITICAL → not a conflict). */
const CONSENSUS_GROUP: FindingGroup = {
  file: "src/auth.ts",
  start_line: 5,
  end_line: 10,
  agent_verdicts: [
    { agent_id: "agent-1", agent_name: "Alpha", finding: makeFinding("CRITICAL") },
    { agent_id: "agent-2", agent_name: "Beta", finding: makeFinding("CRITICAL") },
  ],
};

/** Group where agent A found CRITICAL, agent B found nothing → 2 distinct verdicts. */
const CONFLICT_GROUP_NULL: FindingGroup = {
  file: "src/db.ts",
  start_line: 20,
  end_line: 25,
  agent_verdicts: [
    { agent_id: "agent-1", agent_name: "Alpha", finding: makeFinding("CRITICAL") },
    { agent_id: "agent-2", agent_name: "Beta", finding: null }, // "did_not_flag"
  ],
};

/** Group where agents found different severities → conflict. */
const CONFLICT_GROUP_SEVERITIES: FindingGroup = {
  file: "src/api.ts",
  start_line: 30,
  end_line: 35,
  agent_verdicts: [
    { agent_id: "agent-1", agent_name: "Alpha", finding: makeFinding("CRITICAL") },
    { agent_id: "agent-2", agent_name: "Beta", finding: makeFinding("WARNING") },
  ],
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderSection(props: {
  groups?: FindingGroup[];
  showOnlyConflicts?: boolean;
  onToggle?: () => void;
  allAgentCount?: number;
}) {
  const onToggle = props.onToggle ?? vi.fn();
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiRuns: multiRunsMessages }}>
      <ConflictsSection
        groups={props.groups ?? []}
        showOnlyConflicts={props.showOnlyConflicts ?? false}
        onToggle={onToggle}
        allAgentCount={props.allAgentCount ?? 2}
      />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictsSection", () => {
  it("shows all groups when showOnlyConflicts is false", () => {
    renderSection({
      groups: [CONSENSUS_GROUP, CONFLICT_GROUP_NULL],
      showOnlyConflicts: false,
    });

    // Both group file headers should be visible
    expect(screen.getByText(/src\/auth\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/db\.ts/)).toBeInTheDocument();
  });

  it("toggle has role='switch' and aria-checked reflects current state (false)", () => {
    renderSection({ showOnlyConflicts: false });

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("toggle aria-checked is true when showOnlyConflicts is true", () => {
    renderSection({ showOnlyConflicts: true });

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("clicking the toggle calls onToggle", () => {
    const onToggle = vi.fn();
    renderSection({ showOnlyConflicts: false, onToggle });

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("filters out consensus groups when showOnlyConflicts is true (AC-13)", () => {
    renderSection({
      groups: [CONSENSUS_GROUP, CONFLICT_GROUP_NULL],
      showOnlyConflicts: true,
    });

    // Consensus group (all CRITICAL) should be hidden
    expect(screen.queryByText(/src\/auth\.ts/)).not.toBeInTheDocument();
    // Conflict group (CRITICAL vs did_not_flag) should remain visible
    expect(screen.getByText(/src\/db\.ts/)).toBeInTheDocument();
  });

  it("counts null finding as 'did_not_flag' — a distinct verdict from CRITICAL (AC-13)", () => {
    renderSection({
      groups: [CONFLICT_GROUP_NULL],
      showOnlyConflicts: true,
    });

    // Agent A: CRITICAL, Agent B: null → 2 distinct verdicts → IS a conflict
    expect(screen.getByText(/src\/db\.ts/)).toBeInTheDocument();
    // "did not flag" label should appear for Beta's row
    expect(screen.getByText("did not flag")).toBeInTheDocument();
  });

  it("shows conflict group with two different severity levels (AC-13)", () => {
    renderSection({
      groups: [CONFLICT_GROUP_SEVERITIES],
      showOnlyConflicts: true,
    });

    expect(screen.getByText(/src\/api\.ts/)).toBeInTheDocument();
  });

  it("renders 'requires at least two agents' note when groups is empty and allAgentCount < 2", () => {
    renderSection({
      groups: [],
      allAgentCount: 1,
    });

    expect(
      screen.getByText(
        "Where agents disagree requires at least two agents with results",
      ),
    ).toBeInTheDocument();
  });

  it("does NOT show the 'requires at least two agents' note when allAgentCount >= 2 and groups is empty", () => {
    renderSection({
      groups: [],
      allAgentCount: 2,
      showOnlyConflicts: false,
    });

    // With 2 agents but no groups, the empty state note for "< 2 agents" should not show
    expect(
      screen.queryByText(
        "Where agents disagree requires at least two agents with results",
      ),
    ).not.toBeInTheDocument();
  });
});
