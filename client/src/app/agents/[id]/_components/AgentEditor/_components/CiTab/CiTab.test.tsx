import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiInstallation, CiRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock hooks and ExportWizard
// ---------------------------------------------------------------------------

const mockUpdateAgentMutate = vi.fn();
const mockRemoveInstallationMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/ci", () => ({
  useCiInstallations: vi.fn(),
  useCiRuns: vi.fn(),
  useExportCi: vi.fn(),
  useCiPreflight: vi.fn(),
  useRemoveCiInstallation: vi.fn(),
}));

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: vi.fn(),
}));

// Mock ExportWizard so we can check if it opens
vi.mock("../ExportWizard", () => ({
  ExportWizard: ({ open }: { open: boolean }) =>
    open ? <div data-testid="export-wizard-open">wizard</div> : null,
}));

import {
  useCiInstallations,
  useCiRuns,
  useRemoveCiInstallation,
} from "../../../../../../../lib/hooks/ci";
import { useUpdateAgent } from "../../../../../../../lib/hooks/agents";
import { CiTab } from "./CiTab";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INSTALLATION: CiInstallation = {
  id: "inst1",
  agent_id: "ag1",
  repo: "owner/repo",
  target_type: "gha",
  installed_at: "2026-07-01T10:00:00Z",
};

const RUN: CiRun = {
  id: "r1",
  ci_installation_id: "inst1",
  pr_number: 42,
  ran_at: "2026-07-10T10:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.002,
  github_url: "https://github.com/owner/repo/actions/runs/123",
  source: "ci",
  agent: "My Agent",
  duration_s: 10,
  repo: "owner/repo",
};

function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCiInstallations).mockReturnValue({ data: [INSTALLATION], isLoading: false, isError: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCiRuns).mockReturnValue({ data: [RUN], isLoading: false, isError: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUpdateAgent).mockReturnValue({ mutate: mockUpdateAgentMutate, isPending: false } as any);
  vi.mocked(useRemoveCiInstallation).mockReturnValue({
    mutate: mockRemoveInstallationMutate,
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(() => {
  setupDefaultMocks();
  mockUpdateAgentMutate.mockClear();
  mockRemoveInstallationMutate.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CiTab — deployment summary", () => {
  it("renders deployment summary with correct count from mocked fetchCiInstallations", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.getByText("Active in 1 repo(s)")).toBeInTheDocument();
  });

  it("renders the installation repo name in per-repo list", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    // "owner/repo" appears in both the installation list and the run history row
    expect(screen.getAllByText("owner/repo").length).toBeGreaterThan(0);
  });
});

describe("CiTab — wizard opening", () => {
  it("clicking the dashed 'Add repository' affordance opens wizard (wizard open prop becomes true)", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.queryByTestId("export-wizard-open")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add repository/i }));

    expect(screen.getByTestId("export-wizard-open")).toBeInTheDocument();
  });

  it("clicking per-repo 'Update CI config' opens wizard", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    fireEvent.click(screen.getByRole("button", { name: /update ci config/i }));

    expect(screen.getByTestId("export-wizard-open")).toBeInTheDocument();
  });
});

describe("CiTab — header actions portal", () => {
  function withHeaderSlot() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  }

  it("portals 'Add to CI' and 'Update CI config' into the given headerActionsEl when installations exist", () => {
    const el = withHeaderSlot();
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" headerActionsEl={el} />);

    expect(screen.getByRole("button", { name: /add to ci/i })).toBeInTheDocument();
    // Two "Update CI config" buttons now exist: the portaled header one and the per-repo row one.
    expect(screen.getAllByRole("button", { name: /update ci config/i }).length).toBe(2);

    document.body.removeChild(el);
  });

  it("omits the header 'Update CI config' button when there are no installations", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiInstallations).mockReturnValue({ data: [], isLoading: false, isError: false } as any);
    const el = withHeaderSlot();
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" headerActionsEl={el} />);

    expect(screen.getByRole("button", { name: /add to ci/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update ci config/i })).not.toBeInTheDocument();

    document.body.removeChild(el);
  });

  it("clicking the portaled 'Add to CI' button opens the wizard", () => {
    const el = withHeaderSlot();
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" headerActionsEl={el} />);

    fireEvent.click(screen.getByRole("button", { name: /add to ci/i }));

    expect(screen.getByTestId("export-wizard-open")).toBeInTheDocument();

    document.body.removeChild(el);
  });

  it("renders no header actions when headerActionsEl is not provided", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.queryByRole("button", { name: /add to ci/i })).not.toBeInTheDocument();
  });
});

describe("CiTab — Fail CI on selector", () => {
  it("shows the current ciFailOn value in the selector", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("critical");
  });

  it("calls useUpdateAgent with new ci_fail_on when changed", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "warning" } });

    expect(mockUpdateAgentMutate).toHaveBeenCalledWith({
      id: "ag1",
      patch: { ci_fail_on: "warning" },
    });
  });
});

describe("CiTab — run history table", () => {
  it("renders run history rows from mocked useCiRuns", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.getByText("CI Run History")).toBeInTheDocument();
    // PR number
    expect(screen.getByText("#42")).toBeInTheDocument();
    // Status
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    // Findings count
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("CiTab — remove installation", () => {
  it("renders a Remove button per installation row", () => {
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("clicking Remove after confirming calls the mutation with the installation id", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("owner/repo"));
    expect(mockRemoveInstallationMutate).toHaveBeenCalledWith("inst1");

    confirmSpy.mockRestore();
  });

  it("clicking Remove and declining the confirmation does NOT call the mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockRemoveInstallationMutate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("disables the Remove button while the mutation is pending", () => {
    vi.mocked(useRemoveCiInstallation).mockReturnValue({
      mutate: mockRemoveInstallationMutate,
      isPending: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderWithIntl(<CiTab agentId="ag1" ciFailOn="critical" />);

    expect(screen.getByRole("button", { name: /remove/i })).toBeDisabled();
  });
});
