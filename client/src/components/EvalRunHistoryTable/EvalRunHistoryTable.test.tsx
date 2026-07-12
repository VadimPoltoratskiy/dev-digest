import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunRecord } from "@devdigest/shared";
import messages from "../../../messages/en/eval.json";
import { EvalRunHistoryTable } from "./EvalRunHistoryTable";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const RUN_A: EvalRunRecord = {
  id: "r1",
  case_id: "c1",
  case_name: "Case A",
  ran_at: "2026-07-01T10:00:00.000Z",
  actual_output: null,
  pass: true,
  recall: 1.0,
  precision: 1.0,
  citation_accuracy: 0.5,
  duration_ms: 100,
  cost_usd: 0.001,
};

const RUN_B: EvalRunRecord = {
  id: "r2",
  case_id: "c1",
  case_name: "Case A",
  ran_at: "2026-07-02T10:00:00.000Z",
  actual_output: null,
  pass: false,
  recall: 0.5,
  precision: 0.8,
  citation_accuracy: 0.3,
  duration_ms: 150,
  cost_usd: 0.002,
};

const RUN_C: EvalRunRecord = {
  id: "r3",
  case_id: "c1",
  case_name: "Case A",
  ran_at: "2026-07-03T10:00:00.000Z",
  actual_output: null,
  pass: true,
  recall: 0.9,
  precision: 0.9,
  citation_accuracy: 0.9,
  duration_ms: 120,
  cost_usd: 0.0015,
};

describe("EvalRunHistoryTable", () => {
  it("renders nothing when there are no runs", () => {
    const { container } = renderWithIntl(<EvalRunHistoryTable runs={[]} onCompare={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dedupes multiple rows sharing the same ran_at into one batch row", () => {
    const sameTimestampRun: EvalRunRecord = { ...RUN_A, id: "r1b", case_id: "c2" };
    renderWithIntl(<EvalRunHistoryTable runs={[RUN_A, sameTimestampRun]} onCompare={vi.fn()} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("does not show the Compare button until exactly two rows are selected", () => {
    renderWithIntl(<EvalRunHistoryTable runs={[RUN_A, RUN_B]} onCompare={vi.fn()} />);
    expect(screen.queryByText("Compare")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.queryByText("Compare")).not.toBeInTheDocument();
    expect(screen.getByText("Select a second run to enable comparison.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("replaces the oldest selection when a third row is selected", () => {
    renderWithIntl(<EvalRunHistoryTable runs={[RUN_A, RUN_B, RUN_C]} onCompare={vi.fn()} />);
    // Rows render newest-first: [RUN_C, RUN_B, RUN_A]
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!); // RUN_C
    fireEvent.click(checkboxes[1]!); // RUN_B
    fireEvent.click(checkboxes[2]!); // RUN_A -> replaces the oldest selected (RUN_B, since B < C)

    expect(checkboxes[0]!).toHaveAttribute("aria-checked", "true"); // RUN_C stays selected
    expect(checkboxes[1]!).toHaveAttribute("aria-checked", "false"); // RUN_B was replaced
    expect(checkboxes[2]!).toHaveAttribute("aria-checked", "true"); // RUN_A newly selected
  });

  it("calls onCompare with the two selected ran_at values in chronological order on Compare click", () => {
    const onCompare = vi.fn();
    renderWithIntl(<EvalRunHistoryTable runs={[RUN_A, RUN_B]} onCompare={onCompare} />);

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByText("Compare"));

    expect(onCompare).toHaveBeenCalledWith(RUN_A.ran_at, RUN_B.ran_at);
  });

  it("shows N/A for null metric values", () => {
    const nullRun: EvalRunRecord = { ...RUN_A, recall: null, precision: null, citation_accuracy: null };
    renderWithIntl(<EvalRunHistoryTable runs={[nullRun]} onCompare={vi.fn()} />);
    expect(screen.getAllByText("N/A")).toHaveLength(3);
  });
});
