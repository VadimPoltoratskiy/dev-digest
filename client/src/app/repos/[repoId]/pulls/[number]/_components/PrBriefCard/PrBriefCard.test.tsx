/**
 * PrBriefCard.test.tsx — RTL unit tests for the PrBriefCard component.
 *
 * Covers:
 *   - usePrBrief returns null     → generate button renders; regenerate button absent
 *   - usePrBrief returns a Brief  → what/why/risk_level/review_focus/risks all render
 *   - Clicking generate           → mutate({}) called
 *   - Clicking regenerate         → mutate({ force: true }) called
 *
 * Brief fixture uses all 5 required fields to avoid TS2741 (per client/insights
 * recurring-error note about Zod contracts and test fixtures).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Brief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

// Mock hooks before importing the component (vi.mock is hoisted by Vitest).
vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
}));

import { PrBriefCard } from "./PrBriefCard";
import { usePrBrief, useGenerateBrief } from "../../../../../../../lib/hooks/brief";

afterEach(cleanup);

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Valid Brief fixture — all 5 required fields populated.
 * The Brief Zod schema requires: what, why, risk_level, risks, review_focus.
 */
const BRIEF_FIXTURE: Brief = {
  what: "Adds rate limiting middleware to all public API routes.",
  why: "Prevents denial-of-service attacks on unauthenticated endpoints.",
  risk_level: "medium",
  risks: [
    {
      kind: "security",
      title: "Rate limit bypass via header",
      explanation: "Clients may spoof IP headers to circumvent the limiter.",
      severity: "high",
      file_refs: ["src/middleware/rate.ts"],
    },
  ],
  review_focus: [
    "src/middleware/rate.ts",
    "src/api/public/index.ts",
  ],
};

// ============================================================================
// Helpers
// ============================================================================

const mockMutate = vi.fn();

/** Wrap component in NextIntlClientProvider with the brief namespace. */
function renderCard(prId = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <PrBriefCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("PrBriefCard — no brief yet (usePrBrief returns null)", () => {
  it("renders the generate button and does not render the regenerate button", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: null,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    // Generate button must be visible.
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeInTheDocument();

    // Regenerate button must NOT be visible (no brief exists yet).
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — brief is loaded", () => {
  it("renders what, why, risk_level badge, review_focus list, and at least one risk with its title and file_refs", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF_FIXTURE,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    // 'what' paragraph.
    expect(
      screen.getByText("Adds rate limiting middleware to all public API routes."),
    ).toBeInTheDocument();

    // 'why' paragraph.
    expect(
      screen.getByText("Prevents denial-of-service attacks on unauthenticated endpoints."),
    ).toBeInTheDocument();

    // risk_level badge — the string value "medium" must appear as a badge.
    expect(screen.getByText("medium")).toBeInTheDocument();

    // review_focus items — the second one is unique, so getByText is safe.
    // The first ("src/middleware/rate.ts") also appears in file_refs, so use getAllByText.
    expect(screen.getAllByText("src/middleware/rate.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();

    // At least one risk title.
    expect(screen.getByText("Rate limit bypass via header")).toBeInTheDocument();

    // The risk's file_ref must appear (same text as review_focus item — at least one).
    expect(screen.getAllByText("src/middleware/rate.ts").length).toBeGreaterThanOrEqual(2);
  });
});

describe("PrBriefCard — generate button interaction", () => {
  it("calls mutate({}) when the generate button is clicked", () => {
    mockMutate.mockReset();
    vi.mocked(usePrBrief).mockReturnValue({
      data: null,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({});
  });
});

describe("PrBriefCard — regenerate button interaction", () => {
  it("calls mutate({ force: true }) when the regenerate button is clicked", () => {
    mockMutate.mockReset();
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF_FIXTURE,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({ force: true });
  });
});
