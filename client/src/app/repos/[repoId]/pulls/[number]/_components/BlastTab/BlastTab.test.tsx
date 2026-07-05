import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BlastTab } from "./BlastTab";
import type { BlastRadius } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/hooks", () => ({ useBlastRadius: vi.fn() }));
import { useBlastRadius } from "@/lib/hooks";
const mockUse = vi.mocked(useBlastRadius);

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
});
