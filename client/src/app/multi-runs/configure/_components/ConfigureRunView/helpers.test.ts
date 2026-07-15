import { describe, it, expect } from "vitest";
import { computeAggregateDuration, computeAggregateCost } from "./helpers";
import type { AgentEstimate } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEstimate(
  agentId: string,
  durationMs: number | null,
  costUsd: number | null,
  hasHistoricalData: boolean,
): AgentEstimate {
  return {
    agent_id: agentId,
    agent_name: `Agent ${agentId}`,
    estimated_duration_ms: durationMs,
    estimated_cost_usd: costUsd,
    last_finding_summary: null,
    has_historical_data: hasHistoricalData,
  };
}

const EST_A = makeEstimate("a1", 3000, 0.01, true);
const EST_B = makeEstimate("a2", 5000, 0.02, true);
const EST_C = makeEstimate("a3", null, null, false);
const EST_D = makeEstimate("a4", 2000, 0.005, true);

// ---------------------------------------------------------------------------
// computeAggregateDuration
// ---------------------------------------------------------------------------

describe("computeAggregateDuration", () => {
  it("returns max of selected agents' durations", () => {
    expect(computeAggregateDuration([EST_A, EST_B, EST_D], ["a1", "a2"])).toBe(
      5000,
    );
  });

  it("returns the single duration when only one agent is selected", () => {
    expect(computeAggregateDuration([EST_A, EST_B], ["a1"])).toBe(3000);
  });

  it("returns null when selectedIds is empty", () => {
    expect(computeAggregateDuration([EST_A, EST_B], [])).toBeNull();
  });

  it("returns null when all selected agents have null duration", () => {
    expect(computeAggregateDuration([EST_C], ["a3"])).toBeNull();
  });

  it("ignores unselected agents when computing max", () => {
    // EST_B has duration 5000 but is not selected
    expect(computeAggregateDuration([EST_A, EST_B, EST_D], ["a1", "a4"])).toBe(
      3000,
    );
  });

  it("returns max of available non-null durations when some selected agents have null", () => {
    // EST_C has null duration; EST_A has 3000
    expect(computeAggregateDuration([EST_A, EST_C], ["a1", "a3"])).toBe(3000);
  });

  it("returns null when estimates array is empty", () => {
    expect(computeAggregateDuration([], [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeAggregateCost
// ---------------------------------------------------------------------------

describe("computeAggregateCost", () => {
  it("returns sum of selected agents' costs", () => {
    expect(
      computeAggregateCost([EST_A, EST_B, EST_D], ["a1", "a2"]),
    ).toBeCloseTo(0.03, 5);
  });

  it("returns the single cost when only one agent is selected", () => {
    expect(computeAggregateCost([EST_A, EST_B], ["a2"])).toBeCloseTo(0.02, 5);
  });

  it("returns null when selectedIds is empty", () => {
    expect(computeAggregateCost([EST_A, EST_B], [])).toBeNull();
  });

  it("returns null when all selected agents have null cost", () => {
    expect(computeAggregateCost([EST_C], ["a3"])).toBeNull();
  });

  it("returns sum of available non-null costs when some selected agents have null", () => {
    // EST_C has null cost; EST_A has 0.01
    expect(computeAggregateCost([EST_A, EST_C], ["a1", "a3"])).toBeCloseTo(
      0.01,
      5,
    );
  });

  it("sums three agents correctly", () => {
    expect(
      computeAggregateCost([EST_A, EST_B, EST_D], ["a1", "a2", "a4"]),
    ).toBeCloseTo(0.035, 5);
  });

  it("returns null when estimates array is empty", () => {
    expect(computeAggregateCost([], [])).toBeNull();
  });
});
