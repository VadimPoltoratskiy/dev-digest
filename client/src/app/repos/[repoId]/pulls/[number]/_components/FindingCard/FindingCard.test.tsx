import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

// ---------------------------------------------------------------------------
// AC-19/20: "Turn into eval case" button visibility
// ---------------------------------------------------------------------------

describe("FindingCard — eval case button (AC-19/20)", () => {
  it("AC-19: shows 'Turn into eval case' button when finding is accepted", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z", dismissed_at: null };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("AC-19: shows 'Turn into eval case' button when finding is dismissed", () => {
    const dismissed: FindingRecord = { ...FINDING, accepted_at: null, dismissed_at: "2026-07-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("AC-20: does not show 'Turn into eval case' button when finding is neither accepted nor dismissed", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("calls onCreateEvalCase when the button is clicked", () => {
    const onCreateEvalCase = vi.fn();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z", dismissed_at: null };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onCreateEvalCase={onCreateEvalCase} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(onCreateEvalCase).toHaveBeenCalledOnce();
  });
});
