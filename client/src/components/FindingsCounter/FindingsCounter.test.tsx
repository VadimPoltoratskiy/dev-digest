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
    // WARNING=0 → no WARNING badge rendered
    const badges = screen.queryAllByText("0");
    expect(badges).toHaveLength(0);
  });

  it("opens popover on click and closes with X button", () => {
    renderWithIntl(
      <FindingsCounter summary={{ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }} prId="pr-1" />,
    );
    // Only the trigger exists before open
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    // Popover is open: "No findings" is shown (mock returns no data)
    expect(screen.getByText("No findings")).toBeInTheDocument();
    // Click the X button — the last <button> in the tree
    const allBtns = screen.getAllByRole("button");
    fireEvent.click(allBtns[allBtns.length - 1]!);
    // Popover collapsed
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });

  it("does not open when summary is null", () => {
    renderWithIntl(<FindingsCounter summary={null} prId="pr-1" />);
    const dash = screen.getByText("—");
    fireEvent.click(dash);
    // No popover rendered
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
