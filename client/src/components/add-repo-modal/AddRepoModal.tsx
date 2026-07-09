/* AddRepoModal — shared modal wrapper for the add-repository form. Triggered
   from the AppShell repo switcher, root page empty state, and RepoNotFound CTA.
   The AddRepoView inside renders its own full-screen layout; this component
   provides the modal open/close contract (open prop + Escape key + backdrop),
   plus a focus trap that keeps Tab/Shift+Tab cycling within the modal while
   it is open (WCAG 2.1 SC 2.1.2 — No Keyboard Trap). */
"use client";

import React from "react";
import { Modal } from "@devdigest/ui";
import { AddRepoView } from "./AddRepoView";

interface AddRepoModalProps {
  open: boolean;
  onClose: () => void;
}

/** Selects all element types that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function AddRepoModal({ open, onClose }: AddRepoModalProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Escape key closes the modal (in addition to Modal's built-in backdrop click).
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus trap: on open, move initial focus into the modal and keep Tab cycling
  // contained within the modal's focusable elements (WCAG 2.1 SC 2.1.2).
  // The vendor Modal has no focus-trap support, so we implement it here.
  React.useEffect(() => {
    if (!open || !containerRef.current) return;

    const container = containerRef.current;

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Move initial focus to the first focusable element inside the modal.
    const initialFirst = getFocusable()[0];
    if (initialFirst) {
      initialFirst.focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const elements = getFocusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      // Guard: nothing to cycle when the modal has fewer than 2 focusable elements.
      if (!first || !last) return;

      if (e.shiftKey) {
        // Shift+Tab on the first element → wrap to last.
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab on the last element → wrap to first.
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

  if (!open) return null;

  // The outer div provides the containerRef anchor for focus-trap queries.
  // Modal provides role="dialog", aria-modal="true", a close button (X), and
  // backdrop-click-to-close. AddRepoView provides the form content.
  return (
    <div ref={containerRef}>
      <Modal onClose={onClose}>
        <AddRepoView />
      </Modal>
    </div>
  );
}
