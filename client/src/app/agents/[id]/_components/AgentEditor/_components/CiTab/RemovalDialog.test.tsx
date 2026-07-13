import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiInstallation } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mockRemoveCiFromRepoMutate = vi.fn();
const mockRemoveCiInstallationMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/ci", () => ({
  useCiPreflight: vi.fn(),
  useRemoveCiFromRepo: vi.fn(),
  useRemoveCiInstallation: vi.fn(),
}));

import {
  useCiPreflight,
  useRemoveCiFromRepo,
  useRemoveCiInstallation,
} from "../../../../../../../lib/hooks/ci";
import { RemovalDialog } from "./RemovalDialog";

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

const GHA_INSTALLATION: CiInstallation = {
  id: "inst1",
  agent_id: "ag1",
  repo: "owner/repo",
  target_type: "gha",
  installed_at: "2026-07-01T10:00:00Z",
};

const NON_GHA_INSTALLATION: CiInstallation = {
  id: "inst2",
  agent_id: "ag1",
  repo: "owner/repo",
  target_type: "cli",
  installed_at: "2026-07-01T10:00:00Z",
};

function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCiPreflight).mockReturnValue({
    data: {
      has_write_access: true,
      secrets: { openrouter_api_key: true, github_token: true },
    },
    isLoading: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  vi.mocked(useRemoveCiFromRepo).mockReturnValue({
    mutate: mockRemoveCiFromRepoMutate,
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  vi.mocked(useRemoveCiInstallation).mockReturnValue({
    mutate: mockRemoveCiInstallationMutate,
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(() => {
  setupDefaultMocks();
  mockRemoveCiFromRepoMutate.mockClear();
  mockRemoveCiInstallationMutate.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RemovalDialog — title", () => {
  it("renders the dialog with the repo name in the title", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/owner\/repo/)).toBeInTheDocument();
  });
});

describe("RemovalDialog — GHA installation with write access", () => {
  it("shows the 'Open removal PR' button when GHA and write access granted", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /open removal pr/i })).toBeInTheDocument();
  });

  it("shows the 'Stop tracking only' button for GHA installations", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /stop tracking only/i })).toBeInTheDocument();
  });
});

describe("RemovalDialog — GHA installation without write access", () => {
  it("disables the 'Open removal PR' button when preflight reports no write access", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiPreflight).mockReturnValue({
      data: { has_write_access: false, secrets: { openrouter_api_key: true, github_token: true } },
      isLoading: false,
    } as any);

    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /open removal pr/i })).toBeDisabled();
    expect(screen.getByText(/does not have write access/i)).toBeInTheDocument();
  });
});

describe("RemovalDialog — non-GHA installation", () => {
  it("omits the 'Open removal PR' button for non-GHA installations", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={NON_GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.queryByRole("button", { name: /open removal pr/i })).not.toBeInTheDocument();
  });

  it("still shows 'Stop tracking only' for non-GHA installations", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={NON_GHA_INSTALLATION} onClose={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /stop tracking only/i })).toBeInTheDocument();
  });
});

describe("RemovalDialog — Stop tracking only", () => {
  it("clicking 'Stop tracking only' calls the useRemoveCiInstallation mutation", () => {
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /stop tracking only/i }));

    expect(mockRemoveCiInstallationMutate).toHaveBeenCalledWith(
      "inst1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe("RemovalDialog — PR success state", () => {
  it("shows the PR link after the removal PR mutation succeeds", async () => {
    const PR_URL = "https://github.com/owner/repo/pull/99";

    vi.mocked(useRemoveCiFromRepo).mockReturnValue({
      mutate: (
        _args: unknown,
        callbacks: { onSuccess: (data: { pr_url: string }) => void },
      ) => {
        callbacks.onSuccess({ pr_url: PR_URL });
      },
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open removal pr/i }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /view pr/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /view pr/i })).toHaveAttribute("href", PR_URL);
  });
});

describe("RemovalDialog — keyboard interactions", () => {
  it("calls onClose when the Escape key is pressed", () => {
    const onClose = vi.fn();
    renderWithIntl(
      <RemovalDialog agentId="ag1" installation={GHA_INSTALLATION} onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
