/**
 * ReadThisFirstCard.test.tsx — RTL unit tests for the standalone "Read This First" block.
 *
 * Covers (SPEC-06 AC-8, AC-12):
 *   - renders nothing when the brief is absent (null / undefined / loading)
 *   - renders nothing when review_focus is empty
 *   - renders the heading + one item per review_focus entry when non-empty
 *
 * usePriorPrs and next/navigation are mocked because the rendered subtree
 * includes the child <ReviewFocusItem>, which calls both.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Brief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
}));
vi.mock("@/lib/hooks/pr-files", () => ({
  usePriorPrs: vi.fn(() => ({ data: undefined, isLoading: false })),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "test-repo-id" }),
}));

import { ReadThisFirstCard } from "./ReadThisFirstCard";
import { usePrBrief } from "@/lib/hooks/brief";

afterEach(cleanup);

/** Valid Brief fixture — all 5 required fields populated (avoids TS2741). */
const BRIEF_FIXTURE: Brief = {
  what: "Adds rate limiting.",
  why: "Prevents DoS.",
  risk_level: "low",
  risks: [],
  review_focus: ["src/a.ts", "src/b.ts"],
};

function renderCard(prId = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <ReadThisFirstCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("ReadThisFirstCard — no render (AC-8)", () => {
  it("renders nothing when the brief is null", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: null,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);

    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the brief is undefined", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);

    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the brief is loading", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof usePrBrief>);

    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when review_focus is empty", () => {
    const emptyFocus: Brief = { ...BRIEF_FIXTURE, review_focus: [] };
    vi.mocked(usePrBrief).mockReturnValue({
      data: emptyFocus,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);

    renderCard();
    expect(screen.queryByText("Read This First")).not.toBeInTheDocument();
  });
});

describe("ReadThisFirstCard — populated (AC-7, AC-12)", () => {
  it("renders the heading and one item per review_focus entry", () => {
    vi.mocked(usePrBrief).mockReturnValue({
      data: BRIEF_FIXTURE,
      isLoading: false,
    } as ReturnType<typeof usePrBrief>);

    renderCard();

    expect(screen.getByText("Read This First")).toBeInTheDocument();
    // One toggle button per ReviewFocusItem.
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });
});
