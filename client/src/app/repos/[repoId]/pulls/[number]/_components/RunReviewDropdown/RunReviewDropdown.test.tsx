import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { AgentEstimate } from "@devdigest/shared";

// ---- Module mocks (must be declared before the import of the component) ----

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: vi.fn(() => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Style", model: "claude-3", enabled: true },
    ],
  })),
}));

const mockMutateAsync = vi.fn().mockResolvedValue({
  multi_run_id: "mr-1",
  runs: [{ run_id: "run-1", agent_id: "a1", agent_name: "Security" }],
});

const defaultEstimates: AgentEstimate[] = [
  {
    agent_id: "a1",
    agent_name: "Security",
    estimated_duration_ms: 5000,
    estimated_cost_usd: 0.03,
    last_finding_summary: null,
    has_historical_data: true,
  },
  {
    agent_id: "a2",
    agent_name: "Style",
    estimated_duration_ms: 3000,
    estimated_cost_usd: 0.01,
    last_finding_summary: null,
    has_historical_data: true,
  },
];

// `useAgentEstimates` is a vi.fn() so individual tests can override its return value.
vi.mock("../../../../../../../lib/hooks/multi-runs", () => ({
  useAgentEstimates: vi.fn(() => ({ data: defaultEstimates, isLoading: false })),
  useRunMultiReview: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
}));

// Import after vi.mock declarations.
import { RunReviewDropdown } from "./RunReviewDropdown";
import { useAgentEstimates } from "../../../../../../../lib/hooks/multi-runs";
import { useAgents } from "../../../../../../../lib/hooks/agents";

// ---- Lifecycle --------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Re-establish default estimates after clearAllMocks clears call history.
  vi.mocked(useAgentEstimates).mockReturnValue(
    { data: defaultEstimates, isLoading: false } as ReturnType<typeof useAgentEstimates>,
  );
  vi.mocked(useAgents).mockReturnValue({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Style", model: "claude-3", enabled: true },
    ],
  } as ReturnType<typeof useAgents>);
  mockMutateAsync.mockResolvedValue({
    multi_run_id: "mr-1",
    runs: [{ run_id: "run-1", agent_id: "a1", agent_name: "Security" }],
  });
});

// ---- Helpers ----------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Open the dropdown by clicking the trigger button. */
function openDropdown() {
  fireEvent.click(screen.getByRole("button", { name: /Run Review/i }));
}

// ---- Tests ------------------------------------------------------------------

describe("RunReviewDropdown", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("shows estimate labels for agents with historical data when dropdown opens", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    // Both agents render their estimates: ≈ Xs · $X.XX
    expect(screen.getByText(/≈ 5s · \$0\.03/)).toBeInTheDocument();
    expect(screen.getByText(/≈ 3s · \$0\.01/)).toBeInTheDocument();
  });

  it("shows 'no history yet' for an agent with has_historical_data false", () => {
    const noHistoryEstimates: AgentEstimate[] = [
      {
        agent_id: "a1",
        agent_name: "Security",
        estimated_duration_ms: null,
        estimated_cost_usd: null,
        last_finding_summary: null,
        has_historical_data: false,
      },
    ];
    vi.mocked(useAgentEstimates).mockReturnValue(
      { data: noHistoryEstimates, isLoading: false } as ReturnType<typeof useAgentEstimates>,
    );

    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    expect(screen.getByText("no history yet")).toBeInTheDocument();
  });

  it("primary action is disabled when no agents are selected (0 selected)", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    const primaryAction = screen.getByRole("button", {
      name: /Run multi-agent review \(0 selected\)/i,
    });
    expect(primaryAction).toBeDisabled();
  });

  it("primary action becomes enabled after checking one agent", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    openDropdown();

    // Check the first agent checkbox (role="checkbox" is on the inner button).
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);

    // Button text should now show "1 selected" and not be disabled.
    const primaryAction = screen.getByRole("button", {
      name: /Run multi-agent review \(1 selected\)/i,
    });
    expect(primaryAction).not.toBeDisabled();
  });

  it("calls mutateAsync with correct prId and agentIds when primary action is clicked", async () => {
    renderWithIntl(<RunReviewDropdown prId="pr-test" />);
    openDropdown();

    // Select first agent (Security, id="a1").
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);

    // Click primary action; wrap in act to flush async handlers.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Run multi-agent review \(1 selected\)/i }),
      );
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      prId: "pr-test",
      agentIds: ["a1"],
    });
  });

  it("navigates to /multi-runs/:multiRunId after successful multi-review", async () => {
    renderWithIntl(<RunReviewDropdown prId="pr-nav" />);
    openDropdown();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Run multi-agent review \(1 selected\)/i }),
      );
    });

    expect(mockPush).toHaveBeenCalledWith("/multi-runs/mr-1");
  });

  it("'Configure agents...' link href points to /multi-runs/configure with prId", () => {
    renderWithIntl(<RunReviewDropdown prId="pr-cfg" />);
    openDropdown();

    const configureLink = screen.getByRole("link", { name: /Configure agents/i });
    expect(configureLink).toHaveAttribute("href", "/multi-runs/configure?prId=pr-cfg");
  });

  it("checking a checkbox only toggles selection — it does not start a run", () => {
    renderWithIntl(<RunReviewDropdown prId="pr-test" />);
    openDropdown();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not render the legacy 'run all agents' / per-agent immediate-run list", () => {
    renderWithIntl(<RunReviewDropdown prId="pr-test" />);
    openDropdown();

    expect(screen.queryByText(/Run all enabled agents/i)).not.toBeInTheDocument();
    // Only the checkbox-labeled agent rows should render — no duplicate plain
    // menu-item entries for the same agent names outside the checkbox list.
    expect(screen.getAllByText("Security")).toHaveLength(1);
    expect(screen.getAllByText("Style")).toHaveLength(1);
  });

  it("shows 'No agents yet — create one' when the workspace has zero agents", () => {
    vi.mocked(useAgents).mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useAgents
    >);
    vi.mocked(useAgentEstimates).mockReturnValue(
      { data: [] as AgentEstimate[], isLoading: false } as ReturnType<typeof useAgentEstimates>,
    );

    renderWithIntl(<RunReviewDropdown prId="pr-empty" />);
    openDropdown();

    expect(screen.getByText("No agents yet — create one")).toBeInTheDocument();
  });

  it("shows 'No enabled agents' when agents exist but none are enabled", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: [{ id: "a1", name: "Security", model: "gpt-4.1", enabled: false }],
    } as unknown as ReturnType<typeof useAgents>);
    vi.mocked(useAgentEstimates).mockReturnValue(
      { data: [] as AgentEstimate[], isLoading: false } as ReturnType<typeof useAgentEstimates>,
    );

    renderWithIntl(<RunReviewDropdown prId="pr-disabled" />);
    openDropdown();

    expect(
      screen.getByText("No enabled agents — enable one to run a review"),
    ).toBeInTheDocument();
  });
});
