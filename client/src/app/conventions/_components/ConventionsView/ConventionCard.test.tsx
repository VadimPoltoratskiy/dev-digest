import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "conv1",
  rule: "Always use async/await over raw promises",
  evidence_path: "https://github.com/org/repo/blob/main/src/index.ts#L10",
  evidence_snippet: "const result = await fetchData();",
  confidence: 0.9,
  accepted: false,
};

function renderCard(
  candidate: ConventionCandidate = CANDIDATE,
  overrides: {
    onAccept?: (id: string, accepted: boolean) => void;
    onDelete?: (id: string) => void;
    onEditRule?: (id: string, rule: string) => void;
  } = {},
) {
  const onAccept = overrides.onAccept ?? vi.fn();
  const onDelete = overrides.onDelete ?? vi.fn();
  const onEditRule = overrides.onEditRule ?? vi.fn();

  return {
    onAccept,
    onDelete,
    onEditRule,
    ...render(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard
          candidate={candidate}
          onAccept={onAccept}
          onDelete={onDelete}
          onEditRule={onEditRule}
        />
      </NextIntlClientProvider>,
    ),
  };
}

describe("ConventionCard inline rule editing", () => {
  it("pencil button appears on hover and clicking it enters edit mode", () => {
    renderCard();

    // Rule text is visible initially, no textarea
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Hover over the card to reveal the pencil button (triggers onMouseEnter)
    const ruleText = screen.getByText(CANDIDATE.rule);
    fireEvent.mouseEnter(ruleText.parentElement!);

    // Pencil button should appear
    const pencilBtn = screen.getByRole("button", { name: /edit rule/i });
    expect(pencilBtn).toBeInTheDocument();

    // Click pencil button to enter edit mode
    fireEvent.click(pencilBtn);

    // Edit mode: textarea should appear pre-filled with current rule
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe(CANDIDATE.rule);

    // Save and Cancel buttons should appear
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("typing a new rule and clicking Save calls onEditRule with (id, newText) and exits edit mode", () => {
    const onEditRule = vi.fn();
    renderCard(CANDIDATE, { onEditRule });

    // Enter edit mode via hover + pencil click
    const ruleText = screen.getByText(CANDIDATE.rule);
    fireEvent.mouseEnter(ruleText.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: /edit rule/i }));

    // Change the textarea value
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Always use const over let" } });

    // Save button should be enabled (text changed and non-empty)
    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).not.toBeDisabled();

    // Click Save
    fireEvent.click(saveBtn);

    // onEditRule called with candidate id and trimmed new text
    expect(onEditRule).toHaveBeenCalledOnce();
    expect(onEditRule).toHaveBeenCalledWith(CANDIDATE.id, "Always use const over let");

    // Edit mode exited: textarea gone
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("clicking Cancel exits edit mode without calling onEditRule", () => {
    const onEditRule = vi.fn();
    renderCard(CANDIDATE, { onEditRule });

    // Enter edit mode
    const ruleText = screen.getByText(CANDIDATE.rule);
    fireEvent.mouseEnter(ruleText.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: /edit rule/i }));

    // Modify text
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Some different text" } });

    // Click Cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // onEditRule must NOT have been called
    expect(onEditRule).not.toHaveBeenCalled();

    // Edit mode exited: textarea gone
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Save button is disabled when text is empty", () => {
    renderCard();

    const ruleText = screen.getByText(CANDIDATE.rule);
    fireEvent.mouseEnter(ruleText.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: /edit rule/i }));

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "" } });

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("Save button is disabled when text is unchanged", () => {
    renderCard();

    const ruleText = screen.getByText(CANDIDATE.rule);
    fireEvent.mouseEnter(ruleText.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: /edit rule/i }));

    // No change to textarea value → save should be disabled
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
