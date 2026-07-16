import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import memoryMessages from "../../../../../messages/en/memory.json";
import { MemoryView } from "./MemoryView";
import type { MemoryRecord } from "@devdigest/shared";

// ---------- mocks ----------

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: vi.fn(() => ({
    repoId: "repo-1",
    repos: [{ id: "repo-1", full_name: "acme/payments-api", name: "payments-api" }],
    activeRepo: { id: "repo-1", full_name: "acme/payments-api", name: "payments-api" },
    setRepoId: vi.fn(),
    reposLoaded: true,
  })),
}));

const mockMutate = vi.fn();

vi.mock("@/lib/hooks/memory", () => ({
  useMemory: vi.fn(),
  useCreateMemory: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  usePatchMemory: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
  useDeleteMemory: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
}));

// AppShell uses next/navigation + QueryClient — mock it entirely to avoid provider setup
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// ---------- helpers ----------

import { useMemory } from "@/lib/hooks/memory";

const FULL_CONTENT =
  "Buckets always use version 3 of the signing algorithm, which must be specified explicitly in every PutObject call to avoid runtime errors.";

const sampleRecord: MemoryRecord = {
  id: "rec-1",
  content: FULL_CONTENT,
  scope: "repo",
  kind: "fact",
  confidence: 0.9,
  sources: [{ pr: 482, context: "payments-api" }],
  updated_at: "2026-07-01T00:00:00.000Z",
  last_used_at: null,
};

const sampleRecord2: MemoryRecord = {
  id: "rec-2",
  content: "Team decided not to adopt tRPC — REST is the standard.",
  scope: "team",
  kind: "decision",
  confidence: 0.95,
  sources: [{ context: "team retro 2025-Q3" }],
  updated_at: "2026-06-15T00:00:00.000Z",
  last_used_at: "2026-07-10T00:00:00.000Z",
};

function mockUseMemoryWith(records: MemoryRecord[], searchMode?: string) {
  vi.mocked(useMemory).mockReturnValue({
    data: { records, search_mode: searchMode },
    isLoading: false,
    isError: false,
    isPending: false,
    isSuccess: true,
  } as ReturnType<typeof useMemory>);
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ memory: memoryMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------- tests ----------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemoryView", () => {
  beforeEach(() => {
    mockUseMemoryWith([sampleRecord, sampleRecord2]);
  });

  it("AC-13: renders scope tag, kind tag, confidence %, sources, and dates for each record", () => {
    renderWithIntl(<MemoryView />);

    // scope tags (aria-label="scope" spans, not <option> elements in the select)
    const scopeTags = screen.getAllByLabelText("scope");
    expect(scopeTags.some((el) => el.textContent === "repo")).toBe(true);
    expect(scopeTags.some((el) => el.textContent === "team")).toBe(true);

    // kind tags (aria-label="kind" spans)
    const kindTags = screen.getAllByLabelText("kind");
    expect(kindTags.some((el) => el.textContent === "fact")).toBe(true);
    expect(kindTags.some((el) => el.textContent === "decision")).toBe(true);

    // confidence % (aria-label="confidence" spans)
    const confTags = screen.getAllByLabelText("confidence");
    expect(confTags.some((el) => el.textContent === "90%")).toBe(true);
    expect(confTags.some((el) => el.textContent === "95%")).toBe(true);

    // sources — PR reference
    expect(screen.getByText("PR #482")).toBeInTheDocument();
    // source context (no PR number)
    expect(screen.getByText("team retro 2025-Q3")).toBeInTheDocument();

    // updated_at: year "2026" present in rendered dates
    const texts2026 = screen.getAllByText(/2026/);
    expect(texts2026.length).toBeGreaterThan(0);

    // last_used_at: null → "never used"
    expect(screen.getByText("never used")).toBeInTheDocument();

    // last_used_at non-null → some date text is rendered (Jul)
    const julTexts = screen.getAllByText(/Jul/);
    expect(julTexts.length).toBeGreaterThan(0);
  });

  it("AC-12: shows 'text' badge when search_mode is text", () => {
    mockUseMemoryWith([sampleRecord], "text");
    renderWithIntl(<MemoryView />);
    expect(screen.getByLabelText("search-mode-badge")).toBeInTheDocument();
    expect(screen.getByLabelText("search-mode-badge")).toHaveTextContent("text");
  });

  it("AC-12: shows 'semantic' badge when search_mode is semantic", () => {
    mockUseMemoryWith([sampleRecord], "semantic");
    renderWithIntl(<MemoryView />);
    expect(screen.getByLabelText("search-mode-badge")).toBeInTheDocument();
    expect(screen.getByLabelText("search-mode-badge")).toHaveTextContent("semantic");
  });

  it("AC-12: does not show search-mode badge when search_mode is absent", () => {
    mockUseMemoryWith([sampleRecord], undefined);
    renderWithIntl(<MemoryView />);
    expect(screen.queryByLabelText("search-mode-badge")).not.toBeInTheDocument();
  });

  it("AC-14: clicking a record opens the detail pane with full content", () => {
    renderWithIntl(<MemoryView />);

    // Detail pane is not shown initially
    expect(screen.queryByLabelText("full-content")).not.toBeInTheDocument();

    // FULL_CONTENT is > 120 chars so the card shows a truncated preview
    const truncated = FULL_CONTENT.slice(0, 120) + "…";
    expect(screen.getByText(truncated)).toBeInTheDocument();

    // Click the first record card
    const cards = screen.getAllByRole("button");
    act(() => {
      fireEvent.click(cards[0]!);
    });

    // Detail pane should now show the full content
    const fullContentEl = screen.getByLabelText("full-content");
    expect(fullContentEl).toBeInTheDocument();
    expect(fullContentEl).toHaveTextContent(FULL_CONTENT);
  });

  it("AC-30: 'Show Stale' toggle calls useMemory with freshness='stale'", () => {
    mockUseMemoryWith([], undefined);
    renderWithIntl(<MemoryView />);

    const toggle = screen.getByRole("checkbox");
    act(() => {
      fireEvent.click(toggle);
    });

    // After re-render, useMemory should have been called with freshness='stale'
    const calls = vi.mocked(useMemory).mock.calls;
    const hasStaleCall = calls.some(
      ([filters]) => filters?.freshness === "stale",
    );
    expect(hasStaleCall).toBe(true);
  });

  it("shows empty state when records list is empty", () => {
    mockUseMemoryWith([]);
    renderWithIntl(<MemoryView />);
    expect(screen.getByText("No memory matches")).toBeInTheDocument();
  });

  it("shows loading state without record cards", () => {
    vi.mocked(useMemory).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isPending: true,
      isSuccess: false,
    } as unknown as ReturnType<typeof useMemory>);
    renderWithIntl(<MemoryView />);
    // No record cards during loading
    expect(screen.queryByRole("button", { name: /rec/ })).not.toBeInTheDocument();
    // No empty state either
    expect(screen.queryByText("No memory matches")).not.toBeInTheDocument();
  });
});
