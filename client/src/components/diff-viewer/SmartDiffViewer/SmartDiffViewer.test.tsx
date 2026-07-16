import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/shell.json";
import briefMessages from "../../../../messages/en/brief.json";
import { SmartDiffViewer } from "./SmartDiffViewer";
import type { PrFile, SmartDiff } from "@/lib/types";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages, brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const files: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+const a = 1;\n+const b = 2;" },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+export const x = 1;" },
  { path: "package-lock.json", additions: 92, deletions: 24, patch: "@@ -1,1 +1,1 @@\n-old\n+new" },
];

const smartDiff: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [2],
          finding_ids: ["finding-1"],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: "src/config.ts", pseudocode_summary: null, additions: 4, deletions: 0, finding_lines: [], finding_ids: [] },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 92,
          deletions: 24,
          finding_lines: [],
          finding_ids: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 200, proposed_splits: [] },
};

describe("SmartDiffViewer", () => {
  it("renders core and wiring groups expanded, boilerplate collapsed", () => {
    renderWithIntl(<SmartDiffViewer files={files} smartDiff={smartDiff} />);

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    // Boilerplate group is collapsed by default → its file isn't rendered.
    expect(screen.queryByText("package-lock.json")).not.toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("calls onOpenFinding with the first finding id on badge click and does not scroll the diff", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const onOpenFinding = vi.fn();
    renderWithIntl(<SmartDiffViewer files={files} smartDiff={smartDiff} onOpenFinding={onOpenFinding} />);

    const badge = screen.getByRole("button", { name: "1 finding" });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);

    expect(onOpenFinding).toHaveBeenCalledWith("finding-1");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not render findings badge when finding_ids is empty", () => {
    // Use the wiring file fixture (finding_ids: []) — badge should not appear.
    const diffNoFindings: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            { path: "src/config.ts", pseudocode_summary: null, additions: 4, deletions: 0, finding_lines: [], finding_ids: [] },
          ],
        },
        { role: "wiring", files: [] },
        { role: "boilerplate", files: [] },
      ],
      split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
    };
    renderWithIntl(<SmartDiffViewer files={files} smartDiff={diffNoFindings} />);
    expect(screen.queryByRole("button", { name: /finding/i })).not.toBeInTheDocument();
  });

  it("falls back to the plain file list when smartDiff hasn't loaded", () => {
    renderWithIntl(<SmartDiffViewer files={files} smartDiff={undefined} />);
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });
});
