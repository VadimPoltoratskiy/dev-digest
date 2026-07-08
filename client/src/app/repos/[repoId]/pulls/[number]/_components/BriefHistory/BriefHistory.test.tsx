/**
 * BriefHistory.test.tsx — RTL unit tests for the BriefHistory component.
 *
 * Covers:
 *   - useBriefHistory returns entries → each renders sha/risk_level/why; expand shows what/why/risks
 *   - useBriefHistory returns no entries → empty-state message renders
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefTimelineEntry } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  useBriefHistory: vi.fn(),
}));

import { BriefHistory } from "./BriefHistory";
import { useBriefHistory } from "../../../../../../../lib/hooks/brief";

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

function renderHistory(prId = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <BriefHistory prId={prId} />
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
