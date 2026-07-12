import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";
import { EvalMetricCards } from "./EvalMetricCards";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalMetricCards", () => {
  it("renders the three metric labels and formatted values", () => {
    renderWithIntl(
      <EvalMetricCards
        current={{
          recall: 0.82,
          precision: 0.91,
          citation_accuracy: 0.95,
          traces_passed: 17,
          traces_total: 20,
          cost_usd: 0.23,
        }}
        delta={{ recall: 0.04, precision: -0.02, citation_accuracy: 0.01 }}
      />,
    );

    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();

    expect(screen.getByText("82.0")).toBeInTheDocument();
    expect(screen.getByText("91.0")).toBeInTheDocument();
    expect(screen.getByText("95.0")).toBeInTheDocument();
  });

  it("renders the raw delta magnitude (matching the mockup's '↑ 0.04' style)", () => {
    renderWithIntl(
      <EvalMetricCards
        current={{
          recall: 0.82,
          precision: 0.91,
          citation_accuracy: 0.95,
          traces_passed: 17,
          traces_total: 20,
          cost_usd: 0.23,
        }}
        delta={{ recall: 0.04, precision: -0.02, citation_accuracy: 0.01 }}
      />,
    );

    expect(screen.getByText("0.04")).toBeInTheDocument();
    expect(screen.getByText("0.02")).toBeInTheDocument();
    expect(screen.getByText("0.01")).toBeInTheDocument();
  });
});
