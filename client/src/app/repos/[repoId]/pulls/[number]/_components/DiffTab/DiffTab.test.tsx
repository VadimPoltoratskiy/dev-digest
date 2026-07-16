import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/shell.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { DiffTab } from "./DiffTab";
import type { PrFile, SmartDiff } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: vi.fn(() => ({ data: [] })),
  useCreatePrComment: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
}));

vi.mock("@/lib/hooks/why", () => ({
  useWhyTimeline: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const smartDiffBase: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/a.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [], finding_ids: [] },
      ],
    },
    { role: "wiring", files: [] },
    {
      role: "boilerplate",
      files: [
        { path: "package-lock.json", pseudocode_summary: null, additions: 2, deletions: 0, finding_lines: [], finding_ids: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
};

// We need a mutable reference so we can swap data per-test.
let mockSmartDiffData: SmartDiff | undefined = smartDiffBase;

vi.mock("@/lib/hooks/core", () => ({
  useSmartDiff: vi.fn(() => ({ data: mockSmartDiffData })),
}));

const files: PrFile[] = [
  { path: "src/a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+a" },
  { path: "package-lock.json", additions: 2, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+b" },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages, brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to smart order — boilerplate collapsed, not shown", () => {
    mockSmartDiffData = smartDiffBase;
    renderWithIntl(<DiffTab prId="pr-1" filesCount={2} files={files} />);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByText("package-lock.json")).not.toBeInTheDocument();
  });

  it("switches to original order and shows every file ungrouped", () => {
    mockSmartDiffData = smartDiffBase;
    renderWithIntl(<DiffTab prId="pr-1" filesCount={2} files={files} />);
    fireEvent.click(screen.getByText("Original order"));
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
  });

  it("opens the WhyDrawer when the git-why hover trigger is clicked", () => {
    mockSmartDiffData = smartDiffBase;
    renderWithIntl(<DiffTab prId="pr-1" filesCount={2} files={files} repoFullName="acme/payments-api" />);
    fireEvent.click(screen.getByText("Original order"));

    // "src/a.ts"'s added line ("+a") lands at new-line 1 — same id CodeLine sets.
    const row = document.getElementById("diff-line-src%2Fa.ts-1");
    expect(row).not.toBeNull();
    fireEvent.mouseEnter(row!);

    fireEvent.click(screen.getByRole("button", { name: /show blame history for this line/i }));

    expect(screen.getByText("git-why")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts:1")).toBeInTheDocument();
  });

  it("calls onOpenFinding when findings badge is clicked", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onOpenFinding = vi.fn();

    mockSmartDiffData = {
      groups: [
        {
          role: "core",
          files: [
            {
              path: "src/a.ts",
              pseudocode_summary: null,
              additions: 1,
              deletions: 0,
              finding_lines: [1],
              finding_ids: ["f1"],
            },
          ],
        },
        { role: "wiring", files: [] },
        { role: "boilerplate", files: [] },
      ],
      split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
    };

    renderWithIntl(
      <DiffTab prId="pr-1" filesCount={1} files={[files[0]!]} onOpenFinding={onOpenFinding} />,
    );

    const badge = screen.getByRole("button", { name: /1 finding/i });
    fireEvent.click(badge);
    expect(onOpenFinding).toHaveBeenCalledWith("f1");
  });
});
