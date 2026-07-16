/**
 * ReviewFocusItem.test.tsx — RTL unit tests for the ReviewFocusItem component.
 *
 * Covers:
 *   - AC-6: no request fires until first expand (lazy fetch)
 *   - AC-7: loading state while the prior-PRs request is in flight
 *   - AC-8: empty state when no prior PRs matched
 *   - AC-9: populated list renders number/title/author/status/opened_at and links
 *   - AC-10: truncation indicator when total exceeds items shown
 *   - Independent expansion: two items can be expanded simultaneously
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PriorPr } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../../../messages/en/brief.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "test-repo-id" }),
}));

vi.mock("@/lib/hooks/pr-files", () => ({
  usePriorPrs: vi.fn(),
}));

import { ReviewFocusItem } from "./ReviewFocusItem";
import { usePriorPrs } from "@/lib/hooks/pr-files";

afterEach(cleanup);

function renderItem(prId = "pr-1", path = "src/auth/service.ts") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <ul>
        <ReviewFocusItem prId={prId} path={path} />
      </ul>
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocusItem — lazy fetch (AC-6)", () => {
  it("calls usePriorPrs with enabled=false until expanded", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();

    expect(usePriorPrs).toHaveBeenCalledWith("pr-1", "src/auth/service.ts", false);
  });

  it("calls usePriorPrs with enabled=true after the item is expanded", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(usePriorPrs).toHaveBeenCalledWith("pr-1", "src/auth/service.ts", true);
  });

  it("re-expanding after a collapse relies on TanStack Query's cache, not a fresh fetch", () => {
    // usePriorPrs itself is mocked here, so this can't observe network calls
    // directly — it verifies the component drives `enabled` off its own local
    // `expanded` state each render (true -> false -> true) and hands caching
    // to the query key ["prior-prs", prId, path], per the hook's own doc
    // comment (client/src/lib/hooks/pr-files.ts): "no re-fetch on subsequent
    // expands of the same item."
    vi.mocked(usePriorPrs).mockReturnValue({
      data: { items: [] as PriorPr[], total: 0 },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);
    vi.mocked(usePriorPrs).mockClear();

    renderItem();
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle); // expand
    fireEvent.click(toggle); // collapse
    fireEvent.click(toggle); // re-expand

    const enabledArgs = vi
      .mocked(usePriorPrs)
      .mock.calls.map((call) => call[2]);
    expect(enabledArgs).toEqual([false, true, false, true]);
  });
});

describe("ReviewFocusItem — loading state (AC-7)", () => {
  it("shows a loading indicator and no rows while the request is in flight", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Loading prior PRs…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("ReviewFocusItem — empty state (AC-8)", () => {
  it("shows the empty-state message when items is empty", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: { items: [] as PriorPr[], total: 0 },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(
      screen.getByText("No prior PR history recorded for this path."),
    ).toBeInTheDocument();
  });
});

describe("ReviewFocusItem — populated list (AC-9)", () => {
  it("renders a row per prior PR with all fields and a link to its detail page", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: {
        items: [
          {
            number: 42,
            title: "Refactor auth",
            author: "alice",
            status: "reviewed",
            opened_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        total: 1,
      },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Refactor auth")).toBeInTheDocument();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText(/reviewed/)).toBeInTheDocument();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/repos/test-repo-id/pulls/42");
  });
});

describe("ReviewFocusItem — truncation indicator (AC-10)", () => {
  it("shows a truncation message when total exceeds the number of items shown", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      author: "alice",
      status: "reviewed",
      opened_at: null,
    }));
    vi.mocked(usePriorPrs).mockReturnValue({
      data: { items, total: 15 },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Showing 10 of 15")).toBeInTheDocument();
  });

  it("does not show a truncation message when total equals items shown", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: {
        items: [
          { number: 1, title: "PR 1", author: "alice", status: "reviewed", opened_at: null },
        ],
        total: 1,
      },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    renderItem();
    fireEvent.click(screen.getByRole("button"));

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});

describe("ReviewFocusItem — independent expansion", () => {
  it("allows two instances to be expanded simultaneously", () => {
    vi.mocked(usePriorPrs).mockReturnValue({
      data: { items: [] as PriorPr[], total: 0 },
      isLoading: false,
    } as ReturnType<typeof usePriorPrs>);

    render(
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <ul>
          <ReviewFocusItem prId="pr-1" path="src/a.ts" />
          <ReviewFocusItem prId="pr-1" path="src/b.ts" />
        </ul>
      </NextIntlClientProvider>,
    );

    const [firstToggle, secondToggle] = screen.getAllByRole("button");
    fireEvent.click(firstToggle!);
    fireEvent.click(secondToggle!);

    expect(screen.getAllByText("No prior PR history recorded for this path.")).toHaveLength(2);
  });
});
