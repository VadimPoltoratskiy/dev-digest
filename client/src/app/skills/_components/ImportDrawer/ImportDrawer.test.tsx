/**
 * ImportDrawer — URL tab fetch-to-preview-to-import flow tests.
 *
 * Tests covered:
 *  1. Drawer renders nothing when open=false
 *  2. initialTab controls which tab is active on open
 *  3. URL tab: fetches URL → preview panel appears → import saves with source="imported_url"
 *  4. URL tab: fetch fails → clear error message shown, URL input remains
 *  5. URL tab: "Back" in preview returns to URL input view
 *  6. File tab: preview panel appears after hitting Preview
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import skillsMessages from "../../../../../messages/en/skills.json";

// ---- Module-level mocks (hoisted by Vitest) ----

vi.mock("../../../../lib/hooks/skills", () => ({
  useImportSkillFetch: vi.fn(),
  useImportSkillPreview: vi.fn(),
  useImportSkillSave: vi.fn(),
  useSearchCommunitySkills: vi.fn(),
}));

import {
  useImportSkillFetch,
  useImportSkillPreview,
  useImportSkillSave,
  useSearchCommunitySkills,
} from "../../../../lib/hooks/skills";
import { ImportDrawer } from "./ImportDrawer";

afterEach(cleanup);

// ---- Fixtures ----

const PREVIEW_RESULT = {
  name: "No Hardcoded Secrets",
  body_preview: "# No Hardcoded Secrets\n\nNever commit API keys.",
  token_count: 42,
};

// ---- Setup helpers ----

function setupDefaultMocks(opts: {
  fetchResolvesWith?: typeof PREVIEW_RESULT;
  fetchRejects?: boolean;
  saveRejects?: boolean;
} = {}) {
  const fetchMutateAsync = opts.fetchRejects
    ? vi.fn().mockRejectedValue(new Error("Host not supported"))
    : vi.fn().mockResolvedValue(opts.fetchResolvesWith ?? PREVIEW_RESULT);

  const saveMutateAsync = opts.saveRejects
    ? vi.fn().mockRejectedValue(new Error("Save failed"))
    : vi.fn().mockResolvedValue({ id: "skill-1", name: "No Hardcoded Secrets" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useImportSkillFetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    mutateAsync: fetchMutateAsync,
    isPending: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useImportSkillPreview as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(PREVIEW_RESULT),
    isPending: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useImportSkillSave as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    mutateAsync: saveMutateAsync,
    isPending: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (useSearchCommunitySkills as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [],
    isLoading: false,
  });

  return { fetchMutateAsync, saveMutateAsync };
}

function renderDrawer(props: {
  open?: boolean;
  initialTab?: string;
  onClose?: () => void;
  onImported?: () => void;
}) {
  const { open = true, initialTab = "file", onClose = vi.fn(), onImported = vi.fn() } = props;
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      <ImportDrawer
        open={open}
        onClose={onClose}
        onImported={onImported}
        initialTab={initialTab}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("ImportDrawer", () => {
  describe("visibility", () => {
    it("renders nothing when open=false", () => {
      setupDefaultMocks();
      renderDrawer({ open: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders the drawer when open=true", () => {
      setupDefaultMocks();
      renderDrawer({ open: true });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("initialTab prop", () => {
    it("opens on the file tab by default", () => {
      setupDefaultMocks();
      renderDrawer({ initialTab: "file" });
      // File tab body textarea is visible (use Skill body label text as a proxy)
      expect(screen.getByText("Skill body (Markdown)")).toBeInTheDocument();
    });

    it("opens on the URL tab when initialTab=\"url\"", () => {
      setupDefaultMocks();
      renderDrawer({ initialTab: "url" });
      // URL input placeholder is the raw.githubusercontent.com one
      expect(
        screen.getByPlaceholderText(/raw\.githubusercontent\.com/),
      ).toBeInTheDocument();
      // File body textarea label should NOT be present
      expect(screen.queryByText("Skill body (Markdown)")).not.toBeInTheDocument();
    });

    it("opens on the community tab when initialTab=\"community\"", () => {
      setupDefaultMocks();
      renderDrawer({ initialTab: "community" });
      expect(
        screen.getByPlaceholderText(/search community skills/i),
      ).toBeInTheDocument();
    });
  });

  describe("URL tab — happy path", () => {
    it("fetches URL, shows preview panel, then imports with source=imported_url", async () => {
      const { fetchMutateAsync, saveMutateAsync } = setupDefaultMocks();
      const onImported = vi.fn();
      renderDrawer({ initialTab: "url", onImported });

      // Type a URL into the URL input
      const urlInput = screen.getByPlaceholderText(/raw\.githubusercontent\.com/);
      fireEvent.change(urlInput, {
        target: { value: "https://raw.githubusercontent.com/owner/repo/main/skill.md" },
      });

      // Click "Fetch & preview"
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /fetch & preview/i }));
      });

      expect(fetchMutateAsync).toHaveBeenCalledWith({
        url: "https://raw.githubusercontent.com/owner/repo/main/skill.md",
      });

      // Preview panel: name input should be pre-filled with preview.name
      await waitFor(() => {
        expect(screen.getByDisplayValue("No Hardcoded Secrets")).toBeInTheDocument();
      });

      // Token count line is visible
      expect(screen.getByText(/42/)).toBeInTheDocument();

      // Click "Import skill" to save
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /import skill/i }));
      });

      await waitFor(() => {
        expect(saveMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ source: "imported_url" }),
        );
        expect(onImported).toHaveBeenCalled();
      });
    });

    it("Back button in preview panel returns to the URL input view", async () => {
      setupDefaultMocks();
      renderDrawer({ initialTab: "url" });

      const urlInput = screen.getByPlaceholderText(/raw\.githubusercontent\.com/);
      fireEvent.change(urlInput, {
        target: { value: "https://raw.githubusercontent.com/o/r/main/s.md" },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /fetch & preview/i }));
      });

      await waitFor(() => {
        expect(screen.getByDisplayValue("No Hardcoded Secrets")).toBeInTheDocument();
      });

      // Click "Back" to dismiss the preview
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /back/i }));
      });

      // URL input should be visible again
      expect(screen.getByPlaceholderText(/raw\.githubusercontent\.com/)).toBeInTheDocument();
      // Preview panel name input should be gone
      expect(screen.queryByDisplayValue("No Hardcoded Secrets")).not.toBeInTheDocument();
    });
  });

  describe("URL tab — fetch failure", () => {
    it("shows a clear inline error message when fetch fails", async () => {
      setupDefaultMocks({ fetchRejects: true });
      renderDrawer({ initialTab: "url" });

      const urlInput = screen.getByPlaceholderText(/raw\.githubusercontent\.com/);
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/skill.md" },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /fetch & preview/i }));
      });

      await waitFor(() => {
        expect(screen.getByText(/could not fetch url/i)).toBeInTheDocument();
      });

      // Preview panel should NOT have appeared
      expect(screen.queryByRole("button", { name: /import skill/i })).not.toBeInTheDocument();
    });

    it("keeps the URL input visible so the user can correct the URL", async () => {
      setupDefaultMocks({ fetchRejects: true });
      renderDrawer({ initialTab: "url" });

      const urlInput = screen.getByPlaceholderText(/raw\.githubusercontent\.com/);
      fireEvent.change(urlInput, { target: { value: "https://example.com/skill.md" } });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /fetch & preview/i }));
      });

      await waitFor(() => {
        expect(screen.getByText(/could not fetch url/i)).toBeInTheDocument();
      });

      // URL input is still in the document
      expect(screen.getByPlaceholderText(/raw\.githubusercontent\.com/)).toBeInTheDocument();
    });
  });

  describe("File tab — preview panel reuse", () => {
    it("shows preview panel after clicking Preview", async () => {
      setupDefaultMocks();
      renderDrawer({ initialTab: "file" });

      // Locate the body textarea by its rows attribute (it has rows=10)
      const bodyTextarea = screen.getAllByRole("textbox").find(
        (el) => el.tagName === "TEXTAREA",
      )!;
      fireEvent.change(bodyTextarea, {
        target: { value: "# My Skill\nSome content." },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      });

      // Preview panel shows the name from the server response
      await waitFor(() => {
        expect(screen.getByDisplayValue("No Hardcoded Secrets")).toBeInTheDocument();
      });
    });
  });
});
