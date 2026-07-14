/**
 * ComposeReviewDrawer.test.tsx
 *
 * Covers SPEC-04 acceptance criteria:
 *   AC-3  — no verdict pre-selected; "Post" button is disabled until one is chosen
 *   AC-5  — pre-selects accepted/non-dismissed findings on open
 *   AC-6  — toggling a checkbox adds/removes finding from curated set
 *   AC-7  — inline-comment counter updates immediately on toggle
 *   AC-8  — posting state: button shows "Posting…" and is disabled
 *   AC-10 — success message shows github_review_id when no omissions
 *   AC-11 — success message shows omitted count when present
 *   AC-12 — github_unavailable surfaces "Connect a GitHub token" message
 *   AC-14 — closing and re-opening starts with fresh state
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import composeMessages from "../../../../../../../../messages/en/compose.json";

// Mock the mutation hook before importing the component.
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePostComposeReview: vi.fn(),
}));

// Import AFTER mock setup so the component picks up the mock.
import { ComposeReviewDrawer } from "./ComposeReviewDrawer";
import { usePostComposeReview } from "../../../../../../../lib/hooks/reviews";

afterEach(cleanup);

// ---- Test fixtures ----

const FINDING_ACCEPTED: FindingRecord = {
  id: "f-accepted",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: "Use env vars.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: "2026-07-01T00:00:00.000Z",
  dismissed_at: null,
};

const FINDING_DISMISSED: FindingRecord = {
  id: "f-dismissed",
  severity: "WARNING",
  category: "perf",
  title: "Inefficient loop",
  file: "src/util.ts",
  start_line: 22,
  end_line: 22,
  rationale: "Slow O(n^2).",
  suggestion: null,
  confidence: 0.7,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: "2026-07-02T00:00:00.000Z",
};

const FINDING_NEUTRAL: FindingRecord = {
  id: "f-neutral",
  severity: "SUGGESTION",
  category: "style",
  title: "Missing semicolon",
  file: "src/app.ts",
  start_line: 5,
  end_line: 5,
  rationale: "Consistent style.",
  suggestion: null,
  confidence: 0.6,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

/** Returns a minimal UseMutationResult-like mock for usePostComposeReview. */
function makeMutationMock(
  mutate: ReturnType<typeof vi.fn> = vi.fn(),
  isPending = false,
  data: { github_review_id: string; omitted_count?: number } | undefined = undefined,
) {
  return {
    mutate,
    isPending,
    data,
    isIdle: !isPending,
    isSuccess: data !== undefined,
    isError: false,
    error: null,
    reset: vi.fn(),
    status: isPending ? ("pending" as const) : ("idle" as const),
    variables: undefined,
    submittedAt: 0,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    mutateAsync: vi.fn(),
    context: undefined,
  };
}

// ---- Render helper ----

function renderDrawer(
  props: {
    open?: boolean;
    allFindings?: FindingRecord[];
    onClose?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const { open = true, allFindings = [], onClose = vi.fn() } = props;

  return render(
    <NextIntlClientProvider locale="en" messages={{ compose: composeMessages }}>
      <ComposeReviewDrawer
        prId="pr-001"
        open={open}
        onClose={onClose}
        allFindings={allFindings}
      />
    </NextIntlClientProvider>,
  );
}

// ---- Tests ----

describe("ComposeReviewDrawer — AC-3: no verdict pre-selected, Post disabled", () => {
  beforeEach(() => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof usePostComposeReview>,
    );
  });

  it("renders the drawer title and subtitle", () => {
    renderDrawer();
    expect(screen.getByText("Compose Review")).toBeInTheDocument();
    expect(
      screen.getByText("Post a GitHub review as yourself (PAT)"),
    ).toBeInTheDocument();
  });

  it("shows three verdict options with none pre-selected (aria-pressed=false)", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Comment" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Request changes" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("Post button is disabled when no verdict is selected", () => {
    renderDrawer();
    expect(
      screen.getByRole("button", { name: "Post review to GitHub" }),
    ).toBeDisabled();
  });

  it("Post button becomes enabled after selecting a verdict", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      screen.getByRole("button", { name: "Post review to GitHub" }),
    ).not.toBeDisabled();
  });
});

describe("ComposeReviewDrawer — AC-5: pre-selection of accepted/non-dismissed findings", () => {
  beforeEach(() => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof usePostComposeReview>,
    );
  });

  it("pre-checks accepted/non-dismissed findings and leaves others unchecked", () => {
    // Pass in the order: accepted, dismissed, neutral
    // sortedFindings puts pre-selected first so checkbox[0] = accepted
    renderDrawer({
      allFindings: [FINDING_ACCEPTED, FINDING_DISMISSED, FINDING_NEUTRAL],
    });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();   // FINDING_ACCEPTED
    expect(checkboxes[1]).not.toBeChecked(); // dismissed or neutral
    expect(checkboxes[2]).not.toBeChecked(); // dismissed or neutral
  });

  it("shows 0 pre-selected when all findings are dismissed or neutral", () => {
    renderDrawer({ allFindings: [FINDING_DISMISSED, FINDING_NEUTRAL] });
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
  });
});

describe("ComposeReviewDrawer — AC-6, AC-7: toggling updates checked set and counter", () => {
  beforeEach(() => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof usePostComposeReview>,
    );
  });

  it("counter reflects checked findings; updates immediately on toggle", () => {
    renderDrawer({ allFindings: [FINDING_ACCEPTED, FINDING_NEUTRAL] });

    // Initially 1 finding selected (the accepted one)
    expect(screen.getByText("1 finding")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");

    // Uncheck the accepted finding → 0 selected
    fireEvent.click(checkboxes[0]!);
    expect(screen.getByText("0 findings")).toBeInTheDocument();

    // Check the neutral finding → 1 selected again
    fireEvent.click(checkboxes[1]!);
    expect(screen.getByText("1 finding")).toBeInTheDocument();
  });
});

describe("ComposeReviewDrawer — AC-8: posting state", () => {
  it("Post button shows 'Posting…' and is disabled when isPending=true", () => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock(vi.fn(), true) as unknown as ReturnType<
        typeof usePostComposeReview
      >,
    );
    renderDrawer();
    // The button label is "Posting…" when mutation is pending
    const postBtn = screen.getByRole("button", { name: "Posting…" });
    expect(postBtn).toBeDisabled();
  });
});

describe("ComposeReviewDrawer — AC-10: success message with review id", () => {
  it("shows 'Review posted to GitHub · id {id}.' after a successful post", async () => {
    let capturedCallbacks: {
      onSuccess?: (data: { github_review_id: string }) => void;
    } = {};

    const mockMutate = vi.fn(
      (_body: unknown, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
      },
    );

    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock(mockMutate) as unknown as ReturnType<
        typeof usePostComposeReview
      >,
    );

    renderDrawer();

    // Select verdict and click Post
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Post review to GitHub" }));

    // Simulate onSuccess callback from the mutation
    act(() => {
      capturedCallbacks.onSuccess?.({ github_review_id: "gh-123456" });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Review posted to GitHub · id gh-123456."),
      ).toBeInTheDocument();
    });
  });
});

describe("ComposeReviewDrawer — AC-11: success message with omitted count", () => {
  it("shows omitted count in success message when omitted_count > 0", async () => {
    let capturedCallbacks: {
      onSuccess?: (data: {
        github_review_id: string;
        omitted_count?: number;
      }) => void;
    } = {};

    const mockMutate = vi.fn(
      (_body: unknown, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
      },
    );

    vi.mocked(usePostComposeReview).mockReturnValue(
      {
        ...makeMutationMock(mockMutate),
        // data is available once mutation returns, mirrors what TQ exposes
        data: { github_review_id: "gh-789", omitted_count: 2 },
      } as unknown as ReturnType<typeof usePostComposeReview>,
    );

    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Post review to GitHub" }));

    act(() => {
      capturedCallbacks.onSuccess?.({
        github_review_id: "gh-789",
        omitted_count: 2,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Review posted to GitHub · id gh-789 · 2 comment(s) skipped (out of diff).",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("ComposeReviewDrawer — AC-12: github_unavailable error", () => {
  it("shows 'Connect a GitHub token in Settings → API Keys.' on github_unavailable", async () => {
    let capturedCallbacks: {
      onError?: (err: Error & { code?: string }) => void;
    } = {};

    const mockMutate = vi.fn(
      (_body: unknown, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
      },
    );

    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock(mockMutate) as unknown as ReturnType<
        typeof usePostComposeReview
      >,
    );

    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Post review to GitHub" }));

    // Simulate github_unavailable error (code property matches ApiError.code)
    const err = Object.assign(
      new Error("Connect a GitHub token to post a review."),
      { code: "github_unavailable" },
    );

    act(() => {
      capturedCallbacks.onError?.(err);
    });

    await waitFor(() => {
      expect(
        screen.getByText("Connect a GitHub token in Settings → API Keys."),
      ).toBeInTheDocument();
    });
  });
});

describe("ComposeReviewDrawer — AC-14: cancel discards state; re-open starts fresh", () => {
  beforeEach(() => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof usePostComposeReview>,
    );
  });

  it("clicking Cancel calls onClose", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("re-opening the drawer resets verdict so Post button is disabled again", async () => {
    const onClose = vi.fn();
    const { rerender } = renderDrawer({ onClose });

    // Select a verdict → Post becomes enabled
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      screen.getByRole("button", { name: "Post review to GitHub" }),
    ).not.toBeDisabled();

    // Simulate close (open → false)
    rerender(
      <NextIntlClientProvider locale="en" messages={{ compose: composeMessages }}>
        <ComposeReviewDrawer
          prId="pr-001"
          open={false}
          onClose={onClose}
          allFindings={[]}
        />
      </NextIntlClientProvider>,
    );

    // Simulate re-open (open → true); useEffect should reset state
    rerender(
      <NextIntlClientProvider locale="en" messages={{ compose: composeMessages }}>
        <ComposeReviewDrawer
          prId="pr-001"
          open={true}
          onClose={onClose}
          allFindings={[]}
        />
      </NextIntlClientProvider>,
    );

    // Post button should be disabled again (verdict was reset on re-open)
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Post review to GitHub" }),
      ).toBeDisabled();
    });
  });
});

describe("ComposeReviewDrawer — returns null when closed", () => {
  beforeEach(() => {
    vi.mocked(usePostComposeReview).mockReturnValue(
      makeMutationMock() as unknown as ReturnType<typeof usePostComposeReview>,
    );
  });

  it("renders nothing when open=false", () => {
    renderDrawer({ open: false });
    expect(screen.queryByText("Compose Review")).not.toBeInTheDocument();
  });
});
