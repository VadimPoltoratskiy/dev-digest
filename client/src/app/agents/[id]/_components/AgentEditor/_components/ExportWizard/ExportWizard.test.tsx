import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import JSZip from "jszip";
import type { CiExport, CiFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mockExportMutateAsync = vi.fn();
const mockExportMutate = vi.fn();
const mockPreflightData = {
  has_write_access: false,
  secrets: { openrouter_api_key: false, github_token: true },
};

vi.mock("../../../../../../../lib/hooks/ci", () => ({
  useExportCi: vi.fn(),
  useCiPreflight: vi.fn(),
}));

import { useExportCi, useCiPreflight } from "../../../../../../../lib/hooks/ci";
import { ExportWizard } from "./ExportWizard";

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

const WORKFLOW_FILE: CiFile = {
  path: ".github/workflows/devdigest-review.yml",
  contents: "name: DevDigest Review\non: pull_request:\n",
  editable: true,
};

const MANIFEST_FILE: CiFile = {
  path: ".devdigest/agents/my-agent.yaml",
  contents: "name: My Agent\n",
  editable: false,
};

const EXPORT_RESULT: CiExport = {
  installation: {
    id: "",
    agent_id: "ag1",
    repo: "owner/repo",
    target_type: "gha",
    installed_at: new Date().toISOString(),
  },
  files: [MANIFEST_FILE, WORKFLOW_FILE],
  pr_url: null,
};

function setupDefaultMocks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useExportCi).mockReturnValue({
    mutateAsync: mockExportMutateAsync,
    mutate: mockExportMutate,
    isPending: false,
    isError: false,
    error: null,
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCiPreflight).mockReturnValue({ data: mockPreflightData, isLoading: false, isError: false } as any);
  mockExportMutateAsync.mockResolvedValue(EXPORT_RESULT);
}

beforeEach(setupDefaultMocks);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExportWizard — Step 1: Target", () => {
  it("renders provider options and advances to step 2 after filling repo and clicking Next", async () => {
    renderWithIntl(
      <ExportWizard agentId="ag1" open onClose={vi.fn()} />,
    );

    // Step 1 is active
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();

    // Fill repo field
    const repoInput = screen.getByPlaceholderText("owner/name");
    fireEvent.change(repoInput, { target: { value: "owner/repo" } });

    // Click Next
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Should call exportCi with action: 'files'
    await waitFor(() => {
      expect(mockExportMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "owner/repo", action: "files" }),
      );
    });

    // Should advance to Step 2 (preview)
    await waitFor(() => {
      expect(screen.getByText("Files to create")).toBeInTheDocument();
    });
  });

  it("does not advance if repo is empty", () => {
    renderWithIntl(
      <ExportWizard agentId="ag1" open onClose={vi.fn()} />,
    );

    const nextBtn = screen.getByRole("button", { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });
});

describe("ExportWizard — Step 2: Preview", () => {
  async function advanceToStep2() {
    renderWithIntl(
      <ExportWizard agentId="ag1" open onClose={vi.fn()} />,
    );
    const repoInput = screen.getByPlaceholderText("owner/name");
    fireEvent.change(repoInput, { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Files to create")).toBeInTheDocument());
  }

  it("renders file list and editable textarea with visible label for workflow", async () => {
    await advanceToStep2();

    // File paths listed
    expect(screen.getByText(".github/workflows/devdigest-review.yml")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/agents/my-agent.yaml")).toBeInTheDocument();

    // Workflow YAML label and textarea
    const label = screen.getByText("Workflow YAML");
    expect(label).toBeInTheDocument();

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toBe(WORKFLOW_FILE.contents);
  });
});

describe("ExportWizard — Step 3: Configure", () => {
  async function advanceToStep3() {
    renderWithIntl(
      <ExportWizard agentId="ag1" open onClose={vi.fn()} />,
    );
    const repoInput = screen.getByPlaceholderText("owner/name");
    fireEvent.change(repoInput, { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Files to create")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Post results as")).toBeInTheDocument());
  }

  it("selecting exit_code_only radio updates state and advances to step 4", async () => {
    await advanceToStep3();

    // Find and click exit_code_only radio
    const exitCodeRadio = screen.getByDisplayValue("exit_code_only");
    fireEvent.click(exitCodeRadio);
    expect((exitCodeRadio as HTMLInputElement).checked).toBe(true);

    // Advance to step 4 — "Copy files as a ZIP" appears in both heading and button
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => {
      expect(screen.getAllByText("Copy files as a ZIP").length).toBeGreaterThan(0);
    });
  });

  it("shows 'not set' for OPENROUTER_API_KEY and 'ready' for GITHUB_TOKEN when preflight reports the key missing", async () => {
    await advanceToStep3();

    expect(screen.getByText("not set")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("shows 'ready' for OPENROUTER_API_KEY when preflight reports it configured", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiPreflight).mockReturnValue({
      data: { has_write_access: true, secrets: { openrouter_api_key: true, github_token: true } },
      isLoading: false,
      isError: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await advanceToStep3();

    expect(screen.queryByText("not set")).not.toBeInTheDocument();
    expect(screen.getAllByText("ready").length).toBe(2);
  });

  it("shows 'checking…' while the preflight query is loading", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCiPreflight).mockReturnValue({ data: undefined, isLoading: true, isError: false } as any);

    await advanceToStep3();

    expect(screen.getByText("checking…")).toBeInTheDocument();
  });
});

describe("ExportWizard — Step 4: Install", () => {
  async function advanceToStep4() {
    renderWithIntl(
      <ExportWizard agentId="ag1" open onClose={vi.fn()} />,
    );
    const repoInput = screen.getByPlaceholderText("owner/name");
    fireEvent.change(repoInput, { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Files to create")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Post results as")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // "Copy files as a ZIP" appears in both a heading div and a button — use getAllByText
    await waitFor(() => expect(screen.getAllByText("Copy files as a ZIP").length).toBeGreaterThan(0));
  }

  it("disables 'Open a PR' when preflight returns has_write_access: false", async () => {
    await advanceToStep4();

    // Preflight returns false — Open PR button should be disabled
    const allButtons = screen.getAllByRole("button");
    const openPrButton = allButtons.find(
      (btn) => btn.textContent?.includes("Open a PR") && btn !== screen.queryByRole("button", { name: /copy/i }),
    );
    expect(openPrButton).toBeDefined();
    expect(openPrButton).toBeDisabled();

    // Explanatory message about write access
    expect(screen.getByText(/DevDigest GitHub token lacks write access/)).toBeInTheDocument();
  });

  it("Copy as ZIP button is enabled when write access check fails", async () => {
    await advanceToStep4();

    const zipButtons = screen.getAllByRole("button", { name: /copy files as a zip/i });
    // There should be at least one Copy as ZIP button enabled
    const enabledZipBtn = zipButtons.find((b) => !b.hasAttribute("disabled"));
    expect(enabledZipBtn).toBeDefined();
  });

  it("Copy as ZIP calls JSZip generateAsync", async () => {
    // Spy on JSZip prototype.generateAsync
    const generateSpy = vi
      .spyOn(JSZip.prototype, "generateAsync")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(new Blob() as any);

    // Mock URL APIs so the download link click doesn't crash jsdom
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    await advanceToStep4();

    const zipButtons = screen.getAllByRole("button", { name: /copy files as a zip/i });
    const enabledZipBtn = zipButtons.find((b) => !b.hasAttribute("disabled"));
    expect(enabledZipBtn).toBeDefined();
    fireEvent.click(enabledZipBtn!);

    await waitFor(() => {
      expect(generateSpy).toHaveBeenCalledWith({ type: "blob" });
    });

    generateSpy.mockRestore();
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });
});
