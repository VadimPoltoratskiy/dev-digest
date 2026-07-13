import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/ci-runs.json";

// ---------------------------------------------------------------------------
// Mock hooks and dependencies before importing the component
// ---------------------------------------------------------------------------

vi.mock("../../../../lib/hooks/ci", () => ({
  useCiRuns: vi.fn(),
  useRefreshCiRuns: vi.fn(),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/ci-runs",
}));

import { useCiRuns, useRefreshCiRuns } from "../../../../lib/hooks/ci";
import { CiRunsView } from "./CiRunsView";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ "ci-runs": messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const mockMutate = vi.fn();

function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRefreshCiRuns).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
}

beforeEach(() => {
  setupDefaultMocks();
  mockMutate.mockClear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_1: CiRun = {
  id: "r1",
  ci_installation_id: "inst1",
  pr_number: 42,
  ran_at: "2026-07-10T10:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.0012,
  github_url: "https://github.com/owner/repo/actions/runs/123",
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 12.5,
  repo: "owner/repo",
};

const RUN_NO_URL: CiRun = {
  id: "r2",
  ci_installation_id: "inst1",
  pr_number: 7,
  ran_at: "2026-07-09T08:00:00Z",
  status: "failed",
  findings_count: 0,
  cost_usd: null,
  github_url: null,
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 5.0,
  repo: "owner/repo",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CiRunsView — table rows", () => {
  it("renders table rows from mocked fetchCiRuns response", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiRuns).mockReturnValue({ data: [RUN_1], isLoading: false, isError: false } as any);

    renderWithIntl(<CiRunsView />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("owner/repo")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$0.0012")).toBeInTheDocument();
    expect(screen.getByText("12.5s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "https://github.com/owner/repo/actions/runs/123",
    );
  });

  it("renders '—' in the job column when github_url is null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiRuns).mockReturnValue({ data: [RUN_NO_URL], isLoading: false, isError: false } as any);

    renderWithIntl(<CiRunsView />);

    // Job column should show — (multiple — may appear for other null fields too)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "View" })).not.toBeInTheDocument();
  });

  it("renders the Refresh button and calls mutation on click", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiRuns).mockReturnValue({ data: [], isLoading: false, isError: false } as any);

    renderWithIntl(<CiRunsView />);

    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    expect(refreshBtn).toBeInTheDocument();
    fireEvent.click(refreshBtn);
    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("renders empty state message when data is empty", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiRuns).mockReturnValue({ data: [], isLoading: false, isError: false } as any);

    renderWithIntl(<CiRunsView />);

    expect(screen.getByText(/No CI runs yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
