import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillEvalCase, GeneratedEvalCase } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";
import shellMessages from "../../../../../messages/en/shell.json";
import briefMessages from "../../../../../messages/en/brief.json";
import { ApiError } from "../../../../lib/api";

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateEvalCase: vi.fn(),
  useUpdateEvalCase: vi.fn(),
  useGenerateEvalCase: vi.fn(),
}));

import { useCreateEvalCase, useUpdateEvalCase, useGenerateEvalCase } from "../../../../lib/hooks/skills";
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
let generateMutate: ReturnType<typeof vi.fn>;

function setupDefaultMocks() {
  createMutate = vi.fn();
  updateMutate = vi.fn();
  generateMutate = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCreateEvalCase).mockReturnValue({ mutate: createMutate, isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUpdateEvalCase).mockReturnValue({ mutate: updateMutate, isPending: false } as any);
  vi.mocked(useGenerateEvalCase).mockReturnValue({
    mutate: generateMutate,
    isPending: false,
    isError: false,
    error: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(setupDefaultMocks);

const GENERATED_COUNT_DRAFT: GeneratedEvalCase = {
  name: "generated-count-case",
  notes: null,
  input_diff: "--- a/gen.ts\n+++ b/gen.ts\n@@ -1 +1 @@\n+leak",
  expected_finding_count: 2,
  category: "security",
  severity: "WARNING",
  kind: null,
  file: null,
  start_line: null,
  end_line: null,
  title: null,
};

const GENERATED_MUST_FIND_DRAFT: GeneratedEvalCase = {
  name: "generated-must-find-case",
  notes: null,
  input_diff: "--- a/gen.ts\n+++ b/gen.ts\n@@ -1 +1 @@\n+leak",
  expected_finding_count: null,
  category: "security",
  severity: "CRITICAL",
  kind: "must_find",
  file: "gen.ts",
  start_line: 1,
  end_line: 1,
  title: "Generated finding",
};

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

describe("CaseEditorModal — Generate with AI (create mode only)", () => {
  it("calls generate.mutate with the current kindMode (default 'count')", () => {
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Generate with AI"));

    expect(generateMutate).toHaveBeenCalledWith({ kind_mode: "count" }, expect.anything());
  });

  it("populates name/diff/category/severity/count fields from a count-mode draft", () => {
    generateMutate.mockImplementation((_input, opts) => opts.onSuccess(GENERATED_COUNT_DRAFT));
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Generate with AI"));

    expect(screen.getByDisplayValue("generated-count-case")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/--- a\/src\/config.ts/)).toHaveValue(GENERATED_COUNT_DRAFT.input_diff);
    expect(screen.getByDisplayValue("security")).toBeInTheDocument();
    expect(screen.getByDisplayValue("WARNING")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
  });

  it("switches to must_find mode and populates file/line/title fields from the draft", () => {
    generateMutate.mockImplementation((_input, opts) => opts.onSuccess(GENERATED_MUST_FIND_DRAFT));
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Generate with AI"));

    expect(screen.getByDisplayValue("Must find (file + line range)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gen.ts")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Generated finding")).toBeInTheDocument();
  });

  it("shows a loading label while generation is pending", () => {
    vi.mocked(useGenerateEvalCase).mockReturnValue({
      mutate: generateMutate,
      isPending: true,
      isError: false,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    expect(screen.getByText("Generating…")).toBeInTheDocument();
  });

  it("surfaces the Settings notice on a no_llm_key error", () => {
    vi.mocked(useGenerateEvalCase).mockReturnValue({
      mutate: generateMutate,
      isPending: false,
      isError: true,
      error: new ApiError("no key", 503, "no_llm_key"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    expect(screen.getByText(/Add your API key in Settings/)).toBeInTheDocument();
  });

  it("surfaces the error message for a non-no_llm_key generation failure", () => {
    vi.mocked(useGenerateEvalCase).mockReturnValue({
      mutate: generateMutate,
      isPending: false,
      isError: true,
      error: new ApiError("model overloaded", 502, "external_service_error"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderWithIntl(<CaseEditorModal skillId="skill-1" mode="create" onClose={vi.fn()} />);

    expect(screen.getByText("model overloaded")).toBeInTheDocument();
  });

  it("does not render the Generate button in edit mode", () => {
    renderWithIntl(
      <CaseEditorModal skillId="skill-1" mode="edit" initialCase={EXISTING_CASE} onClose={vi.fn()} />,
    );

    expect(screen.queryByText("Generate with AI")).not.toBeInTheDocument();
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
