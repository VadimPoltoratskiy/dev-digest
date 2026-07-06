import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";
import type { SpecFile } from "@devdigest/shared";

afterEach(cleanup);

vi.mock("../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));
vi.mock("../../lib/hooks/core", () => ({
  useContextFiles: vi.fn(),
}));

import { useActiveRepo } from "../../lib/repo-context";
import { useContextFiles } from "../../lib/hooks/core";
import { ContextDocsEditor } from "./ContextDocsEditor";

const mockActiveRepo = vi.mocked(useActiveRepo);
const mockContextFiles = vi.mocked(useContextFiles);

const FILES: SpecFile[] = [
  { path: "specs/architecture.md", content: "# Architecture", size: 100, updated_at: null, root: "specs", used_by_count: 0 },
  { path: "docs/guide.md", content: "# Guide", size: 50, updated_at: null, root: "docs", used_by_count: 2 },
];

function renderEditor(attachedPaths: string[], onSetPaths = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocsEditor title="Project context" hint="hint text" attachedPaths={attachedPaths} onSetPaths={onSetPaths} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mockActiveRepo.mockReturnValue({
    repoId: "repo-1",
    repos: [],
    activeRepo: null,
    setRepoId: vi.fn(),
    reposLoaded: true,
  } as unknown as ReturnType<typeof useActiveRepo>);
  mockContextFiles.mockReturnValue({
    data: FILES,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useContextFiles>);
});

describe("ContextDocsEditor", () => {
  it("shows a no-repo message when there is no active repo", () => {
    mockActiveRepo.mockReturnValue({
      repoId: null,
      repos: [],
      activeRepo: null,
      setRepoId: vi.fn(),
      reposLoaded: true,
    } as unknown as ReturnType<typeof useActiveRepo>);
    renderEditor([]);
    expect(screen.getByText(/select a repo/i)).toBeInTheDocument();
  });

  it("lists attached documents first, and unattached documents in the add section", () => {
    renderEditor(["specs/architecture.md"]);
    expect(screen.getAllByText("specs/architecture.md")).toHaveLength(1);
    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();
  });

  it("checking an unattached document calls onSetPaths with it appended", () => {
    const onSetPaths = vi.fn();
    renderEditor(["specs/architecture.md"], onSetPaths);
    const checkboxes = screen.getAllByRole("checkbox");
    // Second checkbox belongs to the unattached "docs/guide.md" row.
    fireEvent.click(checkboxes[1]!);
    expect(onSetPaths).toHaveBeenCalledWith(["specs/architecture.md", "docs/guide.md"]);
  });

  it("unchecking an attached document calls onSetPaths without it", () => {
    const onSetPaths = vi.fn();
    renderEditor(["specs/architecture.md", "docs/guide.md"], onSetPaths);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(onSetPaths).toHaveBeenCalledWith(["docs/guide.md"]);
  });

  it("moving the second attached doc up reorders the paths", () => {
    const onSetPaths = vi.fn();
    renderEditor(["specs/architecture.md", "docs/guide.md"], onSetPaths);
    const upButtons = screen.getAllByLabelText("Move up");
    fireEvent.click(upButtons[1]!);
    expect(onSetPaths).toHaveBeenCalledWith(["docs/guide.md", "specs/architecture.md"]);
  });

  it("filters the unattached list by the filter input", () => {
    renderEditor([]);
    const filterInput = screen.getByPlaceholderText("Filter documents…");
    fireEvent.change(filterInput, { target: { value: "guide" } });
    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/architecture.md")).not.toBeInTheDocument();
  });
});
