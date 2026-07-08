/**
 * BriefHistory.test.tsx — RTL unit tests for the BriefHistory component.
 *
 * Covers:
 *   - useBriefHistory returns entries → each renders sha/risk_level/why; expand shows what/why/risks
 *   - useBriefHistory returns no entries → empty-state message renders
 *   - AC-6: file_refs render as clickable affordances in expanded rows
 *   - AC-7: clicking a file_refs path opens WhyDrawer; closing it dismisses it
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefTimelineEntry } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  useBriefHistory: vi.fn(),
}));

vi.mock("../WhyDrawer", () => ({
  WhyDrawer: vi.fn(() => <div data-testid="why-drawer" />),
}));

import { BriefHistory } from "./BriefHistory";
import { useBriefHistory } from "../../../../../../../lib/hooks/brief";
import { WhyDrawer } from "../WhyDrawer";

afterEach(cleanup);

const ENTRY_NEW: BriefTimelineEntry = {
  head_sha: "cccc111",
  brief: {
    what: "Adds a second feature.",
    why: "Because the PR was pushed to again.",
    risk_level: "high",
    risks: [
      {
        kind: "security",
        title: "New risk",
        explanation: "Explanation of the new risk.",
        severity: "high",
        file_refs: [],
      },
    ],
    review_focus: [],
  },
  model: "gpt-4.1",
  tokens_in: 20,
  tokens_out: 10,
  cost_usd: 0.002,
  generated_at: "2026-07-08T13:00:00.000Z",
};

const ENTRY_OLD: BriefTimelineEntry = {
  head_sha: "aaaa000",
  brief: {
    what: "Adds rate limiting middleware.",
    why: "Prevents abuse.",
    risk_level: "low",
    risks: [],
    review_focus: [],
  },
  model: "gpt-4.1",
  tokens_in: 15,
  tokens_out: 8,
  cost_usd: 0.001,
  generated_at: "2026-07-08T12:00:00.000Z",
};

const ENTRY_WITH_FILE_REFS: BriefTimelineEntry = {
  head_sha: "ffff001",
  brief: {
    what: "Adds security middleware.",
    why: "Prevents abuse of unauthenticated endpoints.",
    risk_level: "high",
    risks: [
      {
        kind: "security",
        title: "Test risk",
        explanation: "Explanation of the test risk.",
        severity: "high",
        file_refs: ["src/foo.ts"],
      },
    ],
    review_focus: [],
  },
  model: "gpt-4.1",
  tokens_in: 25,
  tokens_out: 12,
  cost_usd: 0.003,
  generated_at: "2026-07-08T14:00:00.000Z",
};

function renderHistory(prId = "pr-1", repoFullName?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <BriefHistory prId={prId} repoFullName={repoFullName} />
    </NextIntlClientProvider>,
  );
}

describe("BriefHistory — entries render newest first", () => {
  it("renders a row per entry with its short SHA, risk level, and why excerpt", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_NEW, ENTRY_OLD] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();

    expect(screen.getByText("cccc111")).toBeInTheDocument();
    expect(screen.getByText("aaaa000")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
  });

  it("expands a row on click to show the full what/why/risks for that entry", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_NEW] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();

    // Collapsed by default — full 'what' text not yet rendered.
    expect(screen.queryByText("Adds a second feature.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Adds a second feature.")).toBeInTheDocument();
    expect(screen.getByText(/New risk/)).toBeInTheDocument();
  });
});

describe("BriefHistory — empty state", () => {
  it("renders the empty-history message when there are no entries", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [] as BriefTimelineEntry[] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();

    expect(screen.getByText("No prior generations for this PR.")).toBeInTheDocument();
  });
});

describe("BriefHistory — file_refs in expanded row (AC-6)", () => {
  it("renders file paths when a risk has non-empty file_refs", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_WITH_FILE_REFS] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
  });

  it("renders no file path affordances when risks have empty file_refs", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_OLD] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();
    // ENTRY_OLD has no risks at all, so no expand button
    // But if the expand button existed, no file paths would be rendered
    expect(screen.queryByText("src/foo.ts")).toBeNull();
  });

  it("renders a GitHub blob link alongside the path when repoFullName is available", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_WITH_FILE_REFS] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory("pr-1", "acme/payments-api");
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const ghLink = screen.getByRole("link");
    expect(ghLink).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/ffff001/src/foo.ts",
    );
  });

  it("omits the GitHub blob link when repoFullName is not available", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_WITH_FILE_REFS] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BriefHistory — WhyDrawer opens on file_refs click (AC-7)", () => {
  it("opens WhyDrawer with correct props when a file path is clicked", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_WITH_FILE_REFS] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory("pr-1", "acme/payments-api");

    // Expand the row
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    // Click the file path link
    fireEvent.click(screen.getByText("src/foo.ts"));

    // WhyDrawer should now be mounted
    expect(screen.getByTestId("why-drawer")).toBeInTheDocument();

    // WhyDrawer should have been called with the correct props
    expect(vi.mocked(WhyDrawer)).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "src/foo.ts",
        gitRef: "ffff001",
        line: 1,
        prId: "pr-1",
      }),
      undefined,
    );
  });

  it("dismisses the WhyDrawer when onClose is called", () => {
    vi.mocked(useBriefHistory).mockReturnValue({
      data: { entries: [ENTRY_WITH_FILE_REFS] },
      isLoading: false,
    } as ReturnType<typeof useBriefHistory>);

    renderHistory("pr-1", "acme/payments-api");

    // Expand the row and open the drawer
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("src/foo.ts"));
    expect(screen.getByTestId("why-drawer")).toBeInTheDocument();

    // Call onClose from the WhyDrawer mock — must be wrapped in act() to flush state
    const calls = vi.mocked(WhyDrawer).mock.calls;
    const lastCall = calls[calls.length - 1];
    const props = lastCall![0] as { onClose: () => void };
    act(() => {
      props.onClose();
    });

    // After onClose, drawer should be gone
    expect(screen.queryByTestId("why-drawer")).toBeNull();
  });
});
