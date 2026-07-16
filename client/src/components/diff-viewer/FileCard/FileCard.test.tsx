import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";
import type { PrFile } from "@/lib/types";

afterEach(cleanup);

const file: PrFile = {
  path: "src/middleware/ratelimit.ts",
  additions: 10,
  deletions: 2,
  patch: "@@ -0,0 +1,2 @@\n+const a = 1;\n+const b = 2;",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FileCard", () => {
  it("does not render badge when findingIds is undefined", () => {
    renderWithIntl(<FileCard file={file} />);
    expect(screen.queryByRole("button", { name: /finding/i })).not.toBeInTheDocument();
  });

  it("does not render badge when findingIds is empty", () => {
    renderWithIntl(<FileCard file={file} findingIds={[]} />);
    expect(screen.queryByRole("button", { name: /finding/i })).not.toBeInTheDocument();
  });

  it("calls onOpenFinding with first id on badge click and does not call scrollIntoView", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const onOpenFinding = vi.fn();
    renderWithIntl(
      <FileCard file={file} findingIds={["id1", "id2"]} onOpenFinding={onOpenFinding} />,
    );

    const badge = screen.getByRole("button", { name: /2 finding/i });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);

    expect(onOpenFinding).toHaveBeenCalledWith("id1");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
