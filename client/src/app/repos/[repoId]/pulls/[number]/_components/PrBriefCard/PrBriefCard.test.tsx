/**
 * PrBriefCard.test.tsx — RTL unit tests for the PrBriefCard component.
 *
 * Covers:
 *   - usePrBrief returns null     → generate button renders; regenerate button absent
 *   - usePrBrief returns a Brief  → what/why/risk_level/risks all render
 *   - Clicking generate           → mutate({}) called
 *   - Clicking regenerate         → mutate({ force: true }) called
 *
 * Brief fixture uses all 5 required fields to avoid TS2741 (per client/insights
 * recurring-error note about Zod contracts and test fixtures).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Brief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

// Mock hooks before importing the component (vi.mock is hoisted by Vitest).
// useBriefHistory is mocked too — PrBriefCard renders <BriefHistory>, which
// calls it, whenever the "view history" toggle is open.
vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
  useBriefHistory: vi.fn(),
}));

import { PrBriefCard } from "./PrBriefCard";
import { usePrBrief, useGenerateBrief, useBriefHistory } from "../../../../../../../lib/hooks/brief";

// Note: review_focus now renders in the standalone ReadThisFirstCard block, not
// here — so this test no longer mocks next/navigation or @/lib/hooks/pr-files.

afterEach(cleanup);

// The "view history" toggle mounts <BriefHistory>, which calls useBriefHistory.
// Give it a harmless default (loading) so tests that never open the panel
// don't need to stub it individually.
beforeEach(() => {
  vi.mocked(useBriefHistory).mockReturnValue({
    data: undefined,
    isLoading: true,
  } as ReturnType<typeof useBriefHistory>);
});

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
  it("renders what, why, risk_level badge, and at least one risk with its title and file_refs", () => {
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

    // At least one risk title.
    expect(screen.getByText("Rate limit bypass via header")).toBeInTheDocument();

    // The risk's file_ref must still appear inside the risk card. review_focus
    // no longer renders here (it moved to ReadThisFirstCard), so this is the
    // sole occurrence of the path.
    expect(screen.getByText("src/middleware/rate.ts")).toBeInTheDocument();
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

describe("PrBriefCard — degraded banner renders when degraded is true (AC-4)", () => {
  it('renders a role="status" banner containing degraded_reason text when data.degraded is true', () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: {
        ...BRIEF_FIXTURE,
        degraded: true,
        degraded_reason: 'PR too large (9524 lines) — this summary may not reflect all changes',
      },
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('9524');
  });
});

describe("PrBriefCard — no banner when degraded is absent (AC-4)", () => {
  it('does not render a role="status" element when data.degraded is absent', () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF_FIXTURE,  // no degraded field
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);

    renderCard();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — view history toggle", () => {
  it('shows the BriefHistory panel after clicking "View history", and hides it again on second click', () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF_FIXTURE,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);
    vi.mocked(useGenerateBrief).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useGenerateBrief>);
    vi.mocked(useBriefHistory).mockReturnValue({
      data: {
        entries: [
          {
            head_sha: "abc1234",
            brief: BRIEF_FIXTURE,
            model: "gpt-4.1",
            tokens_in: 10,
            tokens_out: 5,
            cost_usd: 0.001,
            generated_at: "2026-07-08T12:00:00.000Z",
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderCard();

    // Panel is closed by default.
    expect(screen.queryByText("abc1234")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view history/i }));
    expect(screen.getByText("abc1234")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /hide history/i }));
    expect(screen.queryByText("abc1234")).not.toBeInTheDocument();
  });
});

describe("Brief client schema backward compatibility (AC-5)", () => {
  it('parses a pre-existing Brief-shaped JSON (no degraded fields) without error', async () => {
    // Import from the client vendor path to test the client-side mirror independently.
    const { Brief } = await import('../../../../../../../vendor/shared/contracts/brief');
    const legacyJson = {
      what: 'legacy what',
      why: 'legacy why',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [],
    };
    const result = Brief.safeParse(legacyJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.degraded).toBeUndefined();
      expect(result.data.degraded_reason).toBeUndefined();
    }
  });
});
