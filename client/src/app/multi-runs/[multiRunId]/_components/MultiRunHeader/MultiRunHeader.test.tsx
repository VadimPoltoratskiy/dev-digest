/**
 * Unit tests for MultiRunHeader component (SPEC-03 AC-16).
 *
 * Test intentions:
 * 1. MultiRunHeader
 *    - breadcrumb shows PR number when prNumber is provided
 *    - breadcrumb falls back to "Multi-Agent Review" title when prNumber is null
 *    - "Configure run" link href includes prId as query param
 *    - Columns button has aria-pressed=true initially; Tabs button has aria-pressed=false
 *    - clicking Tabs button calls onViewModeChange('tabs')
 *    - clicking Columns button calls onViewModeChange('columns')
 *    - summary line shows "running..." text when allComplete=false
 *    - summary line shows duration and cost when allComplete=true with non-null values
 *    - summary line falls back to running text when totalDurationMs or totalCostUsd is null
 *    - mocks needed: next/link (renders as <a>), next-intl (via NextIntlClientProvider)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import { MultiRunHeader } from "./MultiRunHeader";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Mock next/link (renders as a plain <a> in jsdom)
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    style,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <a href={href} style={style}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Render helper
// NOTE: Uses object spread (not ??) so explicit `null` overrides survive.
// ---------------------------------------------------------------------------

interface HeaderProps {
  prId?: string;
  prNumber?: number | null;
  agentCount?: number;
  allComplete?: boolean;
  totalDurationMs?: number | null;
  totalCostUsd?: number | null;
  viewMode?: "columns" | "tabs";
  onViewModeChange?: (mode: "columns" | "tabs") => void;
}

const DEFAULTS = {
  prId: "pr-uuid-123",
  prNumber: 42 as number | null,
  agentCount: 2,
  allComplete: true as boolean,
  totalDurationMs: 5000 as number | null,
  totalCostUsd: 0.02 as number | null, // 0.02.toFixed(2) === "0.02" (float-safe)
  viewMode: "columns" as "columns" | "tabs",
  onViewModeChange: vi.fn() as (mode: "columns" | "tabs") => void,
};

function renderHeader(overrides: HeaderProps = {}) {
  const props = { ...DEFAULTS, ...overrides };
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiRuns: multiRunsMessages }}>
      <MultiRunHeader
        prId={props.prId}
        prNumber={props.prNumber}
        agentCount={props.agentCount}
        allComplete={props.allComplete}
        totalDurationMs={props.totalDurationMs}
        totalCostUsd={props.totalCostUsd}
        viewMode={props.viewMode}
        onViewModeChange={props.onViewModeChange}
      />
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiRunHeader", () => {
  it("shows PR number in breadcrumb when prNumber is provided (AC-16)", () => {
    renderHeader({ prNumber: 42 });

    // The breadcrumb i18n key "results.breadcrumb" interpolates the number
    expect(screen.getByText(/Multi-Agent Review > #42/)).toBeInTheDocument();
  });

  it("shows only 'Multi-Agent Review' title when prNumber is null", () => {
    renderHeader({ prNumber: null });

    // results.title = "Multi-Agent Review" (no # suffix)
    expect(screen.getByText("Multi-Agent Review")).toBeInTheDocument();
    expect(screen.queryByText(/#\d+/)).not.toBeInTheDocument();
  });

  it('"Configure run" link href includes prId as query param', () => {
    renderHeader({ prId: "pr-uuid-123" });

    const link = screen.getByRole("link", { name: "Configure run" });
    expect(link).toHaveAttribute("href", "/multi-runs/configure?prId=pr-uuid-123");
  });

  it("Columns button has aria-pressed=true when viewMode='columns'", () => {
    renderHeader({ viewMode: "columns" });

    const columnsBtn = screen.getByRole("button", { name: "Columns" });
    expect(columnsBtn).toHaveAttribute("aria-pressed", "true");

    const tabsBtn = screen.getByRole("button", { name: "Tabs" });
    expect(tabsBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("Tabs button has aria-pressed=true when viewMode='tabs'", () => {
    renderHeader({ viewMode: "tabs" });

    const tabsBtn = screen.getByRole("button", { name: "Tabs" });
    expect(tabsBtn).toHaveAttribute("aria-pressed", "true");

    const columnsBtn = screen.getByRole("button", { name: "Columns" });
    expect(columnsBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking Tabs button calls onViewModeChange('tabs')", () => {
    const onViewModeChange = vi.fn();
    renderHeader({ viewMode: "columns", onViewModeChange });

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));

    expect(onViewModeChange).toHaveBeenCalledWith("tabs");
  });

  it("clicking Columns button calls onViewModeChange('columns')", () => {
    const onViewModeChange = vi.fn();
    renderHeader({ viewMode: "tabs", onViewModeChange });

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));

    expect(onViewModeChange).toHaveBeenCalledWith("columns");
  });

  it("summary line shows 'running...' text when allComplete is false", () => {
    renderHeader({ allComplete: false, agentCount: 3 });

    // The summaryRunning i18n key: "{count} agents · parallel · running..."
    const summary = screen.getByText(/running\.\.\./);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain("3 agents");
    expect(summary.textContent).toContain("parallel");
  });

  it("summary line shows duration and cost when allComplete is true (AC-16)", () => {
    renderHeader({
      allComplete: true,
      agentCount: 2,
      totalDurationMs: 5000,
      totalCostUsd: 0.02, // (0.02).toFixed(2) === "0.02" — float-safe
    });

    // summaryComplete: "{count} agents · parallel · {duration}s · ${cost}"
    // duration = (5000/1000).toFixed(1) = "5.0"
    // cost = (0.02).toFixed(2) = "0.02"
    const summary = screen.getByText(/agents · parallel/);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain("2 agents");
    expect(summary.textContent).toContain("5.0s");
    expect(summary.textContent).toContain("$0.02");
  });

  it("summary line falls back to running when totalDurationMs or totalCostUsd is null", () => {
    renderHeader({
      allComplete: true,
      agentCount: 2,
      totalDurationMs: null,
      totalCostUsd: null,
    });

    // When cost/duration are null, allComplete=true but durationS/cost become null
    // → component picks summaryRunning variant: "{count} agents · parallel · running..."
    const summary = screen.getByText(/parallel/);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain("running...");
  });
});
