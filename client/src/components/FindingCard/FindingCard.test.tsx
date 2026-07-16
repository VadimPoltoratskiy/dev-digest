import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import evalMessages from "../../../messages/en/eval.json";
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
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
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
// "Turn into eval case" — only rendered for accepted/dismissed findings
// (SPEC-02 AC-19, AC-20), opens a kind-selection modal
// ---------------------------------------------------------------------------

describe("FindingCard — eval case button", () => {
  it("does not show 'Turn into eval case' when the finding is neither accepted nor dismissed (AC-20)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("shows 'Turn into eval case' when the finding is accepted (AC-19)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z", dismissed_at: null };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("shows 'Turn into eval case' when the finding is dismissed (AC-19)", () => {
    const dismissed: FindingRecord = { ...FINDING, accepted_at: null, dismissed_at: "2026-07-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("opens a modal on click, and calls onCreateEvalCase(kind, name) on save", () => {
    const onCreateEvalCase = vi.fn();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z", dismissed_at: null };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onCreateEvalCase={onCreateEvalCase} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(screen.getByText("Must find")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onCreateEvalCase).toHaveBeenCalledWith("must_find", "Hardcoded Stripe secret key");
  });

  it("defaults to must_find for an accepted finding (save without touching the selector)", () => {
    const onCreateEvalCase = vi.fn();
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z", dismissed_at: null };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onCreateEvalCase={onCreateEvalCase} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    fireEvent.click(screen.getByText("Save"));
    expect(onCreateEvalCase).toHaveBeenCalledWith("must_find", "Hardcoded Stripe secret key");
  });

  it("defaults to must_not_flag for a dismissed finding (save without touching the selector)", () => {
    const onCreateEvalCase = vi.fn();
    const dismissed: FindingRecord = { ...FINDING, accepted_at: null, dismissed_at: "2026-07-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onCreateEvalCase={onCreateEvalCase} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    fireEvent.click(screen.getByText("Save"));
    expect(onCreateEvalCase).toHaveBeenCalledWith("must_not_flag", "Hardcoded Stripe secret key");
  });
});

// ---------------------------------------------------------------------------
// "Learn" button — only rendered for accepted/dismissed findings (SPEC-09)
// ---------------------------------------------------------------------------

describe("FindingCard — Learn button", () => {
  it("does not show Learn button when finding is not accepted or dismissed (AC-2)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Learn")).not.toBeInTheDocument();
  });

  it("shows Learn button when finding is accepted (AC-1)", () => {
    const accepted: FindingRecord = {
      ...FINDING,
      accepted_at: "2026-07-01T00:00:00.000Z",
      dismissed_at: null,
    };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded />);
    expect(screen.getByText("Learn")).toBeInTheDocument();
  });

  it("shows Learn button when finding is dismissed (AC-1)", () => {
    const dismissed: FindingRecord = {
      ...FINDING,
      accepted_at: null,
      dismissed_at: "2026-07-01T00:00:00.000Z",
    };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded />);
    expect(screen.getByText("Learn")).toBeInTheDocument();
  });

  it("opens LearnModal on click and calls onLearn with the body on save (AC-3, AC-4)", () => {
    const onLearn = vi.fn();
    const accepted: FindingRecord = {
      ...FINDING,
      accepted_at: "2026-07-01T00:00:00.000Z",
      dismissed_at: null,
    };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onLearn={onLearn} />,
    );

    // Open the modal
    fireEvent.click(screen.getByText("Learn"));

    // Content field is pre-filled with finding title (AC-3)
    const textarea = screen.getByDisplayValue("Hardcoded Stripe secret key");
    expect(textarea).toBeInTheDocument();

    // Click Save
    fireEvent.click(screen.getByText("Save"));

    // onLearn called with default values (AC-3: scope=repo, kind=learning, content=title)
    expect(onLearn).toHaveBeenCalledWith({
      content: "Hardcoded Stripe secret key",
      scope: "repo",
      kind: "learning",
    });
  });

  it("Learn modal Save is disabled while content is blank (AC-9 guard)", () => {
    const accepted: FindingRecord = {
      ...FINDING,
      accepted_at: "2026-07-01T00:00:00.000Z",
      dismissed_at: null,
    };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded />);

    fireEvent.click(screen.getByText("Learn"));

    // Clear the content textarea
    const textarea = screen.getByDisplayValue("Hardcoded Stripe secret key");
    fireEvent.change(textarea, { target: { value: "" } });

    // Save button should be disabled
    const saveBtn = screen.getByText("Save");
    expect(saveBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// "Reply to author" — composer, sends via onAction("reply", text)
// ---------------------------------------------------------------------------

describe("FindingCard — reply to author", () => {
  it("opens the composer, sends a reply, and closes it", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Reply to author"));
    const textarea = screen.getByPlaceholderText("Reply to the author about this finding…");
    fireEvent.change(textarea, { target: { value: "Please rotate this key." } });
    fireEvent.click(screen.getByText("Send reply"));
    expect(onAction).toHaveBeenCalledWith("reply", "Please rotate this key.");
    expect(screen.queryByPlaceholderText("Reply to the author about this finding…")).not.toBeInTheDocument();
  });

  it("closes the composer on cancel without calling onAction", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Reply to author"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Reply to the author about this finding…")).not.toBeInTheDocument();
  });
});
