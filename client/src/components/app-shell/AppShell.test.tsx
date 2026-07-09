import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock AddRepoModal to avoid its dependency chain (AddRepoView / useRouter /
// useAddRepo). This test focuses on AppShell's own wiring, not modal content.
vi.mock("../add-repo-modal", () => ({
  AddRepoModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-repo-modal">Add Repo Modal</div> : null,
}));

// Mock the shell hooks to control context without real API/router dependencies.
// useShellContext passes `onAddRepo` through so clicking "Add repository…" in
// the RepoSwitcher dropdown invokes AppShell's openAddRepo callback directly.
vi.mock("./hooks", () => ({
  useShellContext: vi.fn(({ onAddRepo }: { onAddRepo: () => void }) => ({
    repos: [],
    activeRepo: null,
    repoId: null,
    theme: "dark" as const,
    onToggleTheme: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onSelectRepo: vi.fn(),
    onAddRepo,
    onRemoveRepo: vi.fn(),
  })),
  useShellCommands: vi.fn(() => []),
  useGlobalShortcuts: vi.fn(),
}));

// next/navigation is used by vendor shell components.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

import { AppShell } from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  it("does not render AddRepoModal initially", () => {
    render(<AppShell><div>content</div></AppShell>);
    expect(screen.queryByTestId("add-repo-modal")).not.toBeInTheDocument();
  });

  it("renders AddRepoModal when Add repository is clicked in the repo switcher", () => {
    render(<AppShell><div>content</div></AppShell>);

    // AddRepoModal should not be visible initially.
    expect(screen.queryByTestId("add-repo-modal")).not.toBeInTheDocument();

    // Click the repo switcher trigger ("No repo selected" when activeRepo=null).
    fireEvent.click(screen.getByText("No repo selected"));

    // Click "Add repository…" in the dropdown.
    fireEvent.click(screen.getByText("Add repository…"));

    // AddRepoModal should now be visible.
    expect(screen.getByTestId("add-repo-modal")).toBeInTheDocument();
  });
});
