import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BlastTab } from "./BlastTab";
import type { BlastRadius, BlastExplanation } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/hooks", () => ({
  useBlastRadius: vi.fn(),
  useBlastExplanation: vi.fn(),
  useExplainBlast: vi.fn(),
}));
import { useBlastRadius, useBlastExplanation, useExplainBlast } from "@/lib/hooks";
const mockUse = vi.mocked(useBlastRadius);
const mockExplanation = vi.mocked(useBlastExplanation);
const mockExplain = vi.mocked(useExplainBlast);

const mutate = vi.fn();

beforeEach(() => {
  mutate.mockReset();
  mockExplanation.mockReturnValue({ data: undefined } as ReturnType<typeof useBlastExplanation>);
  mockExplain.mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useExplainBlast>);
});

function mockData(data: BlastRadius | undefined, opts: { isLoading?: boolean; isError?: boolean } = {}) {
  mockUse.mockReturnValue({
    data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as ReturnType<typeof useBlastRadius>);
}

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/shared/helper.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "handler", file: "src/api/public/index.ts", line: 23 },
        { name: "webhook", file: "src/api/public/webhooks.ts", line: 45 },
      ],
      endpoints_affected: ["GET /api/public/items", "POST /api/public/webhooks"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol reach 2 callers across 2 endpoints.",
};

const props = { prId: "pr-1", repoFullName: "acme/payments-api", headSha: "abc123" };

describe("BlastTab", () => {
  it("renders the three levels: symbol, callers, endpoints", () => {
    mockData(BLAST);
    render(<BlastTab {...props} />);

    expect(screen.getByText("rateLimit")).toBeInTheDocument();
    expect(screen.getByText("handler")).toBeInTheDocument();
    expect(screen.getByText("webhook")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("POST /api/public/webhooks")).toBeInTheDocument();
  });

  it("deep-links a caller to its GitHub blob at the exact line", () => {
    mockData(BLAST);
    render(<BlastTab {...props} />);

    const link = screen.getByText("src/api/public/index.ts:23").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23",
    );
  });

  it("shows a degraded banner when the index is partial", () => {
    mockData({ ...BLAST, degraded: true, reason: "no_data" });
    render(<BlastTab {...props} />);
    expect(screen.getByText(/best-effort/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no changed symbols", () => {
    mockData({ changed_symbols: [], downstream: [], summary: "no downstream impact" });
    render(<BlastTab {...props} />);
    expect(screen.getByText(/no downstream callers/i)).toBeInTheDocument();
  });

  it("shows an unavailable state on error", () => {
    mockData(undefined, { isError: true });
    render(<BlastTab {...props} />);
    expect(screen.getByText(/blast radius unavailable/i)).toBeInTheDocument();
  });

  it("offers an opt-in 'Explain with AI' button that fires the mutation on click", () => {
    mockData(BLAST);
    render(<BlastTab {...props} />);
    const btn = screen.getByRole("button", { name: /explain with ai/i });
    expect(mutate).not.toHaveBeenCalled(); // no auto-run
    fireEvent.click(btn);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("renders the AI explanation and switches the button to Regenerate when cached", () => {
    const explanation: BlastExplanation = {
      explanation: "This PR changes the shared rateLimit helper, called by two public handlers.",
      model: "claude-haiku-4-5-20251001",
      tokens_in: 120,
      tokens_out: 40,
      cost_usd: 0.0012,
      generated_at: "2026-07-05T00:00:00Z",
    };
    mockData(BLAST);
    mockExplanation.mockReturnValue({ data: explanation } as ReturnType<typeof useBlastExplanation>);
    render(<BlastTab {...props} />);
    expect(screen.getByText(/shared rateLimit helper/i)).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5-20251001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
  });

  it("shows a pending label while explaining", () => {
    mockData(BLAST);
    mockExplain.mockReturnValue({ mutate, isPending: true } as unknown as ReturnType<typeof useExplainBlast>);
    render(<BlastTab {...props} />);
    expect(screen.getByRole("button", { name: /explaining/i })).toBeInTheDocument();
  });
});
