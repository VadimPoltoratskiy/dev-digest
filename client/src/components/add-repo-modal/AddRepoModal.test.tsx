import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Mock AddRepoView dependencies so tests run hermetically (no API / router).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/hooks", () => ({
  useAddRepo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { AddRepoModal } from "./AddRepoModal";

afterEach(cleanup);

describe("AddRepoModal", () => {
  it("renders nothing when open=false", () => {
    render(<AddRepoModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Add a repository")).not.toBeInTheDocument();
  });

  it("renders AddRepoView content when open=true", () => {
    render(<AddRepoModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Add a repository")).toBeInTheDocument();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<AddRepoModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the modal close button is clicked", () => {
    const onClose = vi.fn();
    render(<AddRepoModal open={true} onClose={onClose} />);
    // Modal from @devdigest/ui renders an X close button (aria-label="Close") in
    // its header. It appears first in DOM order, before AddRepoView's own X button.
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[0]!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when open=false and Escape is pressed", () => {
    const onClose = vi.fn();
    render(<AddRepoModal open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  // Focus-trap tests (WCAG 2.1 SC 2.1.2 — No Keyboard Trap)
  // The vendor Modal has no focus-trap support; AddRepoModal implements it.

  it("moves initial focus into the modal when opened", async () => {
    render(<AddRepoModal open={true} onClose={vi.fn()} />);
    // After render + effects, focus should have moved off document.body and into
    // the first focusable element (the vendor Modal's X close button header).
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    // The first focusable element in DOM order is the vendor Modal's header X button.
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: /close/i })[0]
    );
  });

  it("wraps Tab forward from the last focusable element to the first", async () => {
    render(<AddRepoModal open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });

    // With empty repoUrl, "Add repository" is disabled. The last focusable
    // element is the Cancel button.
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    cancelBtn.focus();
    expect(document.activeElement).toBe(cancelBtn);

    // Tab from the last element — trap must wrap focus to the first.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });

    // Focus should have wrapped to the first focusable element (vendor Modal's X button).
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: /close/i })[0]
    );
  });

  it("wraps Shift+Tab backward from the first focusable element to the last", async () => {
    render(<AddRepoModal open={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });

    // The first focusable element is the vendor Modal's X close button.
    // getAllByRole throws when no elements are found, so [0] is safe to assert non-null.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstFocusable = screen.getAllByRole("button", { name: /close/i })[0]!;
    firstFocusable.focus();
    expect(document.activeElement).toBe(firstFocusable);

    // Shift+Tab from the first element — trap must wrap focus to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    // The last non-disabled focusable element is Cancel ("Add repository" is disabled).
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /cancel/i })
    );
  });
});
