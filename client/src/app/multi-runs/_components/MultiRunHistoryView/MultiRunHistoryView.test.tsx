import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import multiRunsMessages from "../../../../../messages/en/multiRuns.json";
import type { MultiRunSummary } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../../../lib/hooks/multi-runs", () => ({
  useMultiRuns: vi.fn(),
}));

vi.mock("../../../../lib/hooks", () => ({
  useRepos: vi.fn(),
}));

vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

// Mock AppShell: renders children directly, avoiding router/context dependencies.
vi.mock("../../../../components/app-shell", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppShell: ({ children }: { children: any }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Import subjects under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { useMultiRuns } from "../../../../lib/hooks/multi-runs";
import { useRepos } from "../../../../lib/hooks";
import { useActiveRepo } from "../../../../lib/repo-context";
import { MultiRunHistoryView } from "./MultiRunHistoryView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_REPO_1 = {
  id: "repo-1",
  name: "my-repo",
  url: "https://github.com/foo/bar",
  cloneUrl: "https://github.com/foo/bar.git",
  clonedAt: null,
  lastSyncAt: null,
};

const MOCK_REPO_2 = {
  id: "repo-2",
  name: "other-repo",
  url: "https://github.com/foo/other",
  cloneUrl: "https://github.com/foo/other.git",
  clonedAt: null,
  lastSyncAt: null,
};

const MOCK_RUN: MultiRunSummary = {
  id: "mr-abc123",
  pr_id: "pr-uuid-1",
  pr_number: 42,
  pr_title: "Fix auth bug",
  ran_at: "2026-07-01T12:00:00.000Z",
  agent_count: 3,
  status: "done",
  total_cost_usd: null,
  total_duration_ms: null,
};

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

function setupDefaultMocks(overrides: {
  items?: MultiRunSummary[];
  total?: number;
  repos?: typeof MOCK_REPO_1[];
  isLoading?: boolean;
  isError?: boolean;
} = {}) {
  const items = overrides.items ?? [MOCK_RUN];
  const total = overrides.total ?? items.length;
  const repos = overrides.repos ?? [MOCK_REPO_1];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useActiveRepo).mockReturnValue({
    repoId: "repo-1",
    repos,
    activeRepo: MOCK_REPO_1,
    setRepoId: vi.fn(),
    reposLoaded: true,
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRepos).mockReturnValue({ data: repos, isLoading: false } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useMultiRuns).mockReturnValue({
    data: { items, total },
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
  } as any);
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ multiRuns: multiRunsMessages }}>
        <MultiRunHistoryView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiRunHistoryView", () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  it('renders "Multi-Agent Review" heading', async () => {
    renderView();
    expect(await screen.findByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
  });

  it("does NOT render repo select when useRepos returns a single repo", async () => {
    renderView();
    // Wait for the component to settle
    await screen.findByRole("heading", { name: "Multi-Agent Review" });
    expect(screen.queryByLabelText("Select repository")).not.toBeInTheDocument();
  });

  it("renders repo select when useRepos returns two repos", async () => {
    setupDefaultMocks({ repos: [MOCK_REPO_1, MOCK_REPO_2] });
    renderView();
    await screen.findByRole("heading", { name: "Multi-Agent Review" });
    expect(screen.getByLabelText("Select repository")).toBeInTheDocument();
  });

  it("shows empty-state title when useMultiRuns returns empty items", async () => {
    setupDefaultMocks({ items: [], total: 0 });
    renderView();
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByText("No multi-agent review runs for this repo yet.")).toBeInTheDocument();
  });

  it("renders one row per item when data is returned", async () => {
    renderView();
    // PR number + title appear in the row
    expect(await screen.findByText("#42 · Fix auth bug")).toBeInTheDocument();
    // Status badge
    expect(screen.getByText("Done")).toBeInTheDocument();
    // Agent count
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it('"Configure run" button navigates with the active repoId', async () => {
    renderView();
    // Wait for the table to appear (items present → header button visible)
    await screen.findByText("#42 · Fix auth bug");
    const btn = screen.getByRole("button", { name: "Configure run" });
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith(
      "/multi-runs/configure?repoId=repo-1",
    );
  });

  it('"Load more" button is visible when total > items.length', async () => {
    setupDefaultMocks({ items: [MOCK_RUN], total: 5 });
    renderView();
    expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it('"Load more" button is hidden when total === items.length', async () => {
    setupDefaultMocks({ items: [MOCK_RUN], total: 1 });
    renderView();
    await screen.findByText("#42 · Fix auth bug");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("clicking a row calls router.push with /multi-runs/:id", async () => {
    renderView();
    const prCell = await screen.findByText("#42 · Fix auth bug");
    fireEvent.click(prCell);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/multi-runs/mr-abc123");
    });
  });

  it("shows loading state on first page load", async () => {
    setupDefaultMocks({ isLoading: true, items: [], total: 0 });
    renderView();
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });

  it("shows error state when query fails", async () => {
    setupDefaultMocks({ isError: true, items: [], total: 0 });
    renderView();
    expect(await screen.findByText("Failed to load history")).toBeInTheDocument();
    expect(screen.getByText("Could not load multi-agent run history.")).toBeInTheDocument();
  });
});
