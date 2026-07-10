import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillEvalCase } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";
import shellMessages from "../../../../../messages/en/shell.json";
import briefMessages from "../../../../../messages/en/brief.json";

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateEvalCase: vi.fn(),
  useUpdateEvalCase: vi.fn(),
}));

import { useCreateEvalCase, useUpdateEvalCase } from "../../../../lib/hooks/skills";
import { CaseEditorModal } from "./CaseEditorModal";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, shell: shellMessages, brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

let createMutate: ReturnType<typeof vi.fn>;
let updateMutate: ReturnType<typeof vi.fn>;

function setupDefaultMocks() {
  createMutate = vi.fn();
  updateMutate = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCreateEvalCase).mockReturnValue({ mutate: createMutate, isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUpdateEvalCase).mockReturnValue({ mutate: updateMutate, isPending: false } as any);
}

beforeEach(setupDefaultMocks);

const EXISTING_CASE: SkillEvalCase = {
  id: "case-1",
  skill_id: "skill-1",
  name: "stripe-key-leak",
  notes: null,
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,2 +1,3 @@\n+  stripeKey: \"sk_live_x\",",
  expected: {
    expected_finding_count: 1,
    category: "security",
    severity: "CRITICAL",
    kind: "must_find",
    file: "src/config.ts",
    start_line: 3,
    end_line: 3,
    title: "Hardcoded Stripe key",
  },
  latest_run: null,
};

describe("CaseEditorModal — create mode", () => {
  it("disables Save until name and diff are filled", () => {
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("enables Save once name and diff are filled, and creates a count-based case by default", () => {
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), {
      target: { value: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+x" },
    });

    const saveBtn = screen.getByText("Save");
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-case", expected_finding_count: 1 }),
      expect.anything(),
    );
  });

  it("switching to 'must find' requires a file before Save enables", () => {
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), {
      target: { value: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+x" },
    });
    fireEvent.change(screen.getByDisplayValue("Finding count"), { target: { value: "must_find" } });

    expect(screen.getByText("Save")).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("server/src/modules/reviews/routes.ts"), {
      target: { value: "server/src/routes.ts" },
    });
    expect(screen.getByText("Save")).not.toBeDisabled();

    fireEvent.click(screen.getByText("Save"));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-case", kind: "must_find", file: "server/src/routes.ts" }),
      expect.anything(),
    );
  });

  it("renders a diff preview when the Preview tab is selected", () => {
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/--- a\/src\/config.ts/), {
      target: { value: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+hello" },
    });
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });
});

describe("CaseEditorModal — edit mode", () => {
  it("prefills fields from the existing case and calls update on save", () => {
    renderWithIntl(
      <CaseEditorModal skillId="skill-1" mode="edit" initialCase={EXISTING_CASE} onClose={vi.fn()} />,
    );

    expect(screen.getByDisplayValue("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByDisplayValue("src/config.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save"));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "case-1",
        patch: expect.objectContaining({ kind: "must_find", file: "src/config.ts" }),
      }),
      expect.anything(),
    );
  });
});
