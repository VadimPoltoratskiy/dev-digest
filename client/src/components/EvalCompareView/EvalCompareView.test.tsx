import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalCompare } from "@devdigest/shared";
import messages from "../../../messages/en/eval.json";

vi.mock("../../lib/hooks", () => ({
  useAgentEvalRunsCompare: vi.fn(),
}));

import { useAgentEvalRunsCompare } from "../../lib/hooks";
import { EvalCompareView } from "./EvalCompareView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const COMPARE_DATA: AgentEvalCompare = {
  run_a: { ran_at: "2026-07-01T10:00:00.000Z", recall: 1.0, precision: 1.0, citation_accuracy: 0.5, cost_usd: 0.001 },
  run_b: { ran_at: "2026-07-02T10:00:00.000Z", recall: 0.5, precision: 0.8, citation_accuracy: 0.3, cost_usd: 0.002 },
  deltas: { recall: -0.5, precision: -0.2, citation_accuracy: -0.2, cost_usd: 0.001 },
  flips: [{ case_id: "c1", case_name: "My flip case", from_pass: true, to_pass: false }],
};

describe("EvalCompareView", () => {
  it("renders a loading skeleton while the comparison is fetching", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: undefined, isLoading: true, isError: false } as any);
    renderWithIntl(<EvalCompareView agentId="ag1" runA="a" runB="b" onBack={vi.fn()} />);
    expect(screen.getByText("Comparing runs")).toBeInTheDocument();
  });

  it("renders an error state when the comparison fails to load", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: undefined, isLoading: false, isError: true } as any);
    renderWithIntl(<EvalCompareView agentId="ag1" runA="a" runB="b" onBack={vi.fn()} />);
    expect(screen.getByText("Failed to load run comparison.")).toBeInTheDocument();
  });

  it("renders metric deltas and the case-flips table when data is loaded", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: COMPARE_DATA, isLoading: false, isError: false } as any);
    renderWithIntl(<EvalCompareView agentId="ag1" runA="a" runB="b" onBack={vi.fn()} />);

    expect(screen.getByText("Metric deltas")).toBeInTheDocument();
    expect(screen.getByText("-50.0%")).toBeInTheDocument();
    expect(screen.getByText("Case flips")).toBeInTheDocument();
    expect(screen.getByText("My flip case")).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAgentEvalRunsCompare).mockReturnValue({ data: COMPARE_DATA, isLoading: false, isError: false } as any);
    renderWithIntl(<EvalCompareView agentId="ag1" runA="a" runB="b" onBack={onBack} />);
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
