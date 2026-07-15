import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import multiRunsMessages from "../../../../../../messages/en/multiRuns.json";
import type { AgentEstimate } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../../../../lib/hooks/multi-runs", () => ({
  useAgentEstimates: vi.fn(),
  useRunMultiReview: vi.fn(),
}));

vi.mock("../../../../../lib/hooks", () => ({
  useRepos: vi.fn(),
  usePulls: vi.fn(),
}));

vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

// Mock AppShell: renders children directly, avoiding router/context dependencies.
vi.mock("../../../../../components/app-shell", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppShell: ({ children }: { children: any }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Import subject under test (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  useAgentEstimates,
  useRunMultiReview,
} from "../../../../../lib/hooks/multi-runs";
import { useRepos, usePulls } from "../../../../../lib/hooks";
import { useActiveRepo } from "../../../../../lib/repo-context";
import { ConfigureRunView } from "./ConfigureRunView";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const AGENT_WITH_HISTORY: AgentEstimate = {
  agent_id: "agent-1",
  agent_name: "Alpha",
  estimated_duration_ms: 3000,
  estimated_cost_usd: 0.01,
  last_finding_summary: "Found 2 critical security issues.",
  has_historical_data: true,
};

const AGENT_WITH_HISTORY_2: AgentEstimate = {
  agent_id: "agent-2",
  agent_name: "Beta",
  estimated_duration_ms: 5000,
  estimated_cost_usd: 0.02,
  last_finding_summary: "No major issues found.",
  has_historical_data: true,
};

const AGENT_NO_HISTORY: AgentEstimate = {
  agent_id: "agent-3",
  agent_name: "Gamma",
  estimated_duration_ms: null,
  estimated_cost_usd: null,
  last_finding_summary: null,
  has_historical_data: false,
};

const MOCK_PR = {
  id: "pr-uuid-1",
  number: 42,
  title: "Fix auth bug",
  author: "alice",
  branch: "fix/auth",
  base: "main",
  head_sha: "abc123",
  additions: 10,
  deletions: 5,
  files_count: 2,
  status: "open" as const,
};

const MOCK_REPO = { id: "repo-1", name: "my-repo", url: "https://github.com/foo/bar", cloneUrl: "https://github.com/foo/bar.git", clonedAt: null, lastSyncAt: null };

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

function setupDefaultMocks(overrides: {
  estimates?: AgentEstimate[];
  prId?: string | null;
  mutateAsync?: () => Promise<unknown>;
} = {}) {
  const estimates = overrides.estimates ?? [AGENT_WITH_HISTORY, AGENT_WITH_HISTORY_2];
  const selectedPrId = overrides.prId !== undefined ? overrides.prId : "pr-uuid-1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentEstimates).mockReturnValue({
    data: selectedPrId ? estimates : undefined,
    isLoading: false,
    isError: false,
  } as any);

  const mutateAsync =
    overrides.mutateAsync ??
    vi.fn().mockResolvedValue({
      multi_run_id: "mr-new",
      runs: [{ run_id: "run-1", agent_id: "agent-1", agent_name: "Alpha" }],
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRunMultiReview).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useRepos).mockReturnValue({ data: [MOCK_REPO], isLoading: false } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(usePulls).mockReturnValue({ data: [MOCK_PR], isLoading: false } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useActiveRepo).mockReturnValue({ repoId: "repo-1", repos: [MOCK_REPO], activeRepo: MOCK_REPO, setRepoId: vi.fn(), reposLoaded: true } as any);

  return { mutateAsync };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderView(props: { initialPrId?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ multiRuns: multiRunsMessages }}>
        <ConfigureRunView {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigureRunView", () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  it("renders Step 2 agent cards when initialPrId is pre-set", () => {
    renderView({ initialPrId: "pr-uuid-1" });

    // Agent cards should appear
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it('shows "no history yet" for both duration and cost when has_historical_data is false', () => {
    setupDefaultMocks({ estimates: [AGENT_NO_HISTORY] });
    renderView({ initialPrId: "pr-uuid-1" });

    // "no history yet" should appear for each field (duration + cost = 2 instances)
    const noHistoryEls = screen.getAllByText("no history yet");
    expect(noHistoryEls.length).toBeGreaterThanOrEqual(2);
  });

  it("computes max duration in footer when 2 agents are selected", async () => {
    // EST_A=3000ms, EST_B=5000ms → max=5000ms=5s
    renderView({ initialPrId: "pr-uuid-1" });

    // Select all via "Select all" checkbox
    const selectAllCheckbox = screen.getByLabelText("Select all");
    fireEvent.click(selectAllCheckbox);

    // Footer shows the full estimate string including duration (max=5s) and cost (sum=$0.03)
    // Multiple elements may contain "≈ 5.0s" (also in the Beta agent card), so match the full footer
    const footerEls = await screen.findAllByText(/≈ 5\.0s/);
    // At least one of them should be the footer aggregate line containing "parallel fan-out"
    const footerEl = footerEls.find((el) =>
      el.textContent?.includes("parallel fan-out"),
    );
    expect(footerEl).toBeDefined();
  });

  it("computes sum cost in footer when 2 agents are selected", async () => {
    // EST_A=0.01, EST_B=0.02 → sum=0.03
    renderView({ initialPrId: "pr-uuid-1" });

    const selectAllCheckbox = screen.getByLabelText("Select all");
    fireEvent.click(selectAllCheckbox);

    // Footer should show $0.03
    expect(await screen.findByText(/\$0\.03/)).toBeInTheDocument();
  });

  it('"Select all" selects all agents', async () => {
    renderView({ initialPrId: "pr-uuid-1" });

    const selectAllCheckbox = screen.getByLabelText("Select all");
    expect(selectAllCheckbox).not.toBeChecked();

    fireEvent.click(selectAllCheckbox);

    // Both agent checkboxes should now be checked
    expect(screen.getByLabelText("Select Alpha")).toBeChecked();
    expect(screen.getByLabelText("Select Beta")).toBeChecked();
    expect(selectAllCheckbox).toBeChecked();
  });

  it("submit button is disabled when no PR is selected", () => {
    // No initialPrId → selectedPrId = null → can't submit
    setupDefaultMocks({ prId: null });
    renderView(); // no initialPrId

    const submitBtn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(submitBtn).toBeDisabled();
  });

  it("submit button is disabled when no agents are selected", () => {
    renderView({ initialPrId: "pr-uuid-1" });
    // No agent is checked yet

    const submitBtn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(submitBtn).toBeDisabled();
  });

  it("submit button is enabled when PR and agents are selected", async () => {
    renderView({ initialPrId: "pr-uuid-1" });

    // Select one agent
    fireEvent.click(screen.getByLabelText("Select Alpha"));

    const submitBtn = screen.getByRole("button", { name: /Run multi-agent review/i });
    expect(submitBtn).toBeEnabled();
  });

  it("calls triggerMultiReview with correct prId and agentIds, then navigates", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      multi_run_id: "mr-123",
      runs: [{ run_id: "run-1", agent_id: "agent-1", agent_name: "Alpha" }],
    });
    setupDefaultMocks({ mutateAsync });

    renderView({ initialPrId: "pr-uuid-1" });

    // Select Alpha agent
    fireEvent.click(screen.getByLabelText("Select Alpha"));

    // Click submit
    const submitBtn = screen.getByRole("button", { name: /Run multi-agent review/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        prId: "pr-uuid-1",
        agentIds: ["agent-1"],
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/multi-runs/mr-123");
    });
  });

  it("renders last_finding_summary as plain text, not dangerouslySetInnerHTML", () => {
    const xssPayload = "<script>alert('xss')</script>";
    setupDefaultMocks({
      estimates: [
        {
          ...AGENT_WITH_HISTORY,
          last_finding_summary: xssPayload,
        },
      ],
    });
    renderView({ initialPrId: "pr-uuid-1" });

    // The summary should appear as plain text (the raw string, not executed)
    expect(screen.getByText(xssPayload)).toBeInTheDocument();

    // Verify it's NOT injected as HTML — no <script> tag should exist in the DOM
    const scriptTags = document.querySelectorAll("script");
    // The only scripts are from the test setup, not from our component
    const injectedScript = Array.from(scriptTags).find(
      (el) => el.textContent?.includes("alert"),
    );
    expect(injectedScript).toBeUndefined();
  });
});
