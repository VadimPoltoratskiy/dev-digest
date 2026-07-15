// Test intentions:
// 1. FindingsCounter (PR-list mode — existing tests, summary prop + fetch on open)
//    - happy path: summary null → renders dash
//    - happy path: all-zero summary → renders dash
//    - happy path: non-zero counts → renders only the non-zero severity badges
//    - happy path: opens popover on click, close X button removes it
//    - boundary: summary null → trigger is NOT interactive (no role=button)
//    - mocks needed: usePrReviews (hoisted module mock)
//
// 2. FindingsCounter (per-run mode — new tests, findings prop drives everything)
//    - happy path: [2 CRITICAL + 1 SUGGESTION] findings → derives badge "2" and "1"
//      without consulting summary prop or the hook
//    - boundary: dismissed finding (dismissed_at truthy) → excluded from derived count
//    - happy path: opening popover lists the PROVIDED finding's title; usePrReviews
//      returns undefined, proving the popover does not depend on the fetch
//    - boundary: trigger has role="button" when prId=null but findings has undismissed items
//    - mocks needed: usePrReviews (same hoisted mock — should be inert in per-run mode)

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsCounter } from "./FindingsCounter";

afterEach(cleanup);

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
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

describe("FindingsCounter", () => {
  it("renders a dash when summary is null", () => {
    renderWithIntl(<FindingsCounter summary={null} prId="pr-1" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a dash when all counts are zero", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} prId="pr-1" />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders only non-zero severity badges", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 2, WARNING: 0, SUGGESTION: 1 }} prId="pr-1" />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    // WARNING=0 → no badge with count "0"
    expect(screen.queryAllByText("0")).toHaveLength(0);
  });

  it("opens popover into document.body on click and closes with X button", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }} prId="pr-1" />,
    );
    // Before open: only the trigger role="button" div is present
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    // Popover is rendered into document.body via portal — "No findings" is visible
    expect(screen.getByText("No findings")).toBeInTheDocument();

    // The X close button appears in the portal content
    const allBtns = screen.getAllByRole("button");
    // [0] = trigger div, [1] = X button inside portal
    fireEvent.click(allBtns[allBtns.length - 1]!);

    // After closing, portal is gone
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });

  it("does not open when summary is null", () => {
    renderWithIntl(<FindingsCounter summary={null} prId="pr-1" />);
    // No role="button" → clicking the dash does nothing
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("—"));
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });

  describe("per-run mode (findings prop provided)", () => {
    it("derives severity badge counts from the provided findings array", () => {
      renderWithIntl(
        <FindingsCounter
          summary={null}
          prId={null}
          findings={[
            makeFinding({ id: "f-1", severity: "CRITICAL" }),
            makeFinding({ id: "f-2", severity: "CRITICAL" }),
            makeFinding({ id: "f-3", severity: "SUGGESTION" }),
          ]}
        />,
      );
      // Derived summary: CRITICAL=2, WARNING=0, SUGGESTION=1
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
      // WARNING=0 → no badge rendered
      expect(screen.queryAllByText("0")).toHaveLength(0);
    });

    it("excludes dismissed findings from the derived badge counts", () => {
      renderWithIntl(
        <FindingsCounter
          summary={null}
          prId={null}
          findings={[
            makeFinding({ id: "f-1", severity: "CRITICAL", dismissed_at: "2026-01-01T00:00:00.000Z" }),
            makeFinding({ id: "f-2", severity: "CRITICAL", dismissed_at: "2026-01-01T00:00:00.000Z" }),
            makeFinding({ id: "f-3", severity: "WARNING" }),
          ]}
        />,
      );
      // CRITICAL findings are dismissed → their count is 0, no "2" badge
      expect(screen.queryByText("2")).not.toBeInTheDocument();
      // Undismissed WARNING finding → badge "1" is visible
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("opens popover listing provided finding titles without relying on usePrReviews", () => {
      renderWithIntl(
        <FindingsCounter
          summary={null}
          prId={null}
          findings={[
            makeFinding({ id: "f-1", severity: "CRITICAL", title: "SQL injection in auth handler" }),
          ]}
        />,
      );
      // Only the trigger exists before opening (no popover yet)
      const trigger = screen.getByRole("button");
      fireEvent.click(trigger);
      // The provided finding's title appears in the popover body
      // (usePrReviews mock returns undefined — per-run mode ignores it)
      expect(screen.getByText("SQL injection in auth handler")).toBeInTheDocument();
    });

    it("trigger has role button when prId is null but findings include undismissed items", () => {
      renderWithIntl(
        <FindingsCounter
          summary={null}
          prId={null}
          findings={[makeFinding({ id: "f-1", severity: "CRITICAL" })]}
        />,
      );
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
  });
});
