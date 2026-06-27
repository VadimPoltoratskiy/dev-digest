import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/prReview.json";
import { FindingsCounter } from "./FindingsCounter";

afterEach(cleanup);

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsCounter", () => {
  it("renders a dash when summary is null", () => {
    renderWithIntl(<FindingsCounter summary={null} prId="pr-1" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a dash when all counts are zero", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} prId="pr-1" />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders only non-zero severity badges", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 2, WARNING: 0, SUGGESTION: 1 }} prId="pr-1" />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    // WARNING=0 → no badge with count "0"
    expect(screen.queryAllByText("0")).toHaveLength(0);
  });

  it("opens popover into document.body on click and closes with X button", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }} prId="pr-1" />,
    );
    // Before open: only the trigger role="button" div is present
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    // Popover is rendered into document.body via portal — "No findings" is visible
    expect(screen.getByText("No findings")).toBeInTheDocument();

    // The X close button appears in the portal content
    const allBtns = screen.getAllByRole("button");
    // [0] = trigger div, [1] = X button inside portal
    fireEvent.click(allBtns[allBtns.length - 1]!);

    // After closing, portal is gone
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });

  it("does not open when summary is null", () => {
    renderWithIntl(<FindingsCounter summary={null} prId="pr-1" />);
    // No role="button" → clicking the dash does nothing
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("—"));
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });
});
