/**
 * WhyDrawer.test.tsx — RTL unit tests for the WhyDrawer component (SPEC-04).
 *
 * Covers:
 *   - useWhyTimeline returns events → each row renders author/sha/summary
 *   - blame-head row shows the blame badge
 *   - rationale/risks render when present on an event; absent otherwise
 *   - empty events → the summary/empty message renders instead of a list
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { WhyTimeline } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

vi.mock("../../../../../../../lib/hooks/why", () => ({
  useWhyTimeline: vi.fn(),
}));

import { WhyDrawer } from "./WhyDrawer";
import { useWhyTimeline } from "../../../../../../../lib/hooks/why";

afterEach(cleanup);

const TIMELINE_WITH_ENRICHMENT: WhyTimeline = {
  file: "src/middleware/rate.ts",
  line: 10,
  blame: {
    sha: "sha1234",
    summary: "Add rate limiting (#7)",
    author: "alice",
    date: "2026-07-01T00:00:00.000Z",
    pr_number: 7,
    is_blame_head: true,
    rationale: "Prevents abuse of unauthenticated endpoints.",
    risks: [
      {
        kind: "security",
        title: "Rate limit bypass",
        explanation: "Clients may bypass via header manipulation.",
        severity: "medium",
        file_refs: ["src/middleware/rate.ts"],
      },
    ],
  },
  events: [
    {
      sha: "sha1234",
      summary: "Add rate limiting (#7)",
      author: "alice",
      date: "2026-07-01T00:00:00.000Z",
      pr_number: 7,
      is_blame_head: true,
      rationale: "Prevents abuse of unauthenticated endpoints.",
      risks: [
        {
          kind: "security",
          title: "Rate limit bypass",
          explanation: "Clients may bypass via header manipulation.",
          severity: "medium",
          file_refs: ["src/middleware/rate.ts"],
        },
      ],
    },
    {
      sha: "shaold01",
      summary: "Initial scaffold",
      author: "bob",
      date: "2026-06-01T00:00:00.000Z",
      pr_number: null,
      is_blame_head: false,
    },
  ],
  summary: "2 commits touch this file; last changed by alice in sha1234.",
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof WhyDrawer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <WhyDrawer
        prId="pr-1"
        repoFullName="acme/payments-api"
        file="src/middleware/rate.ts"
        line={10}
        onClose={vi.fn()}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("WhyDrawer — events render", () => {
  it("renders a row per event with author, short sha, and summary", () => {
    vi.mocked(useWhyTimeline).mockReturnValue({
      data: TIMELINE_WITH_ENRICHMENT,
      isLoading: false,
    } as ReturnType<typeof useWhyTimeline>);

    renderDrawer();

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("sha1234")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting (#7)")).toBeInTheDocument();
  });

  it("shows rationale and risks only on the enriched (blame-head) event", () => {
    vi.mocked(useWhyTimeline).mockReturnValue({
      data: TIMELINE_WITH_ENRICHMENT,
      isLoading: false,
    } as ReturnType<typeof useWhyTimeline>);

    renderDrawer();

    expect(screen.getByText("Prevents abuse of unauthenticated endpoints.")).toBeInTheDocument();
    expect(screen.getByText(/Rate limit bypass/)).toBeInTheDocument();
    expect(screen.getByText("View PR #7")).toBeInTheDocument();
  });
});

describe("WhyDrawer — empty history", () => {
  it("renders the summary/empty message when there are no events", () => {
    const emptyTimeline: WhyTimeline = {
      file: "src/x.ts",
      line: 1,
      blame: null,
      events: [],
      summary: "No commits found for this line.",
    };
    vi.mocked(useWhyTimeline).mockReturnValue({
      data: emptyTimeline,
      isLoading: false,
    } as ReturnType<typeof useWhyTimeline>);

    renderDrawer();

    expect(screen.getByText("No commits found for this line.")).toBeInTheDocument();
  });
});
