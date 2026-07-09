import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import { ApiError } from "../../../../lib/api";
import messages from "../../../../../messages/en/onboarding.json";

// ── Module mocks (must be before dynamic import) ──────────────────────────────

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));

vi.mock("../../../../lib/hooks/onboarding", () => ({
  useOnboardingTour: vi.fn(),
  useGenerateOnboarding: vi.fn(),
}));

// next/link renders an <a> in tests — this stub is simpler & avoids the
// Next.js router context requirement.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { useActiveRepo } from "../../../../lib/repo-context";
import { useOnboardingTour, useGenerateOnboarding } from "../../../../lib/hooks/onboarding";
import { OnboardingView } from "./OnboardingView";

const mockUseActiveRepo = vi.mocked(useActiveRepo);
const mockUseOnboardingTour = vi.mocked(useOnboardingTour);
const mockUseGenerateOnboarding = vi.mocked(useGenerateOnboarding);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EXPECTED_SECTION_TITLES = [
  "Architecture Overview",
  "Critical Paths",
  "How to Run Locally",
  "Guided Reading Order",
  "First Tasks",
] as const;

const EXPECTED_SECTION_KINDS = [
  "architecture_overview",
  "critical_paths",
  "how_to_run",
  "reading_order",
  "first_tasks",
] as const;

function makeTour(extra: Partial<{ degraded: boolean }> = {}): Onboarding & {
  generatedAt: string;
  degraded?: boolean;
} {
  return {
    sections: EXPECTED_SECTION_KINDS.map((kind, i) => ({
      kind,
      title: EXPECTED_SECTION_TITLES[i] as string,
      body: `Body of ${EXPECTED_SECTION_TITLES[i]}`,
      diagram: null,
      links: [],
    })),
    generatedAt: "2026-07-07T12:00:00.000Z",
    ...extra,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultGenerateMock() {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useGenerateOnboarding>;
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingView />
    </NextIntlClientProvider>,
  );
}

// ── Test setup/teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  mockUseActiveRepo.mockReturnValue({
    repoId: "repo-123",
    repos: [],
    activeRepo: null,
    setRepoId: vi.fn(),
    reposLoaded: true,
  } as unknown as ReturnType<typeof useActiveRepo>);

  mockUseGenerateOnboarding.mockReturnValue(defaultGenerateMock());
});

afterEach(cleanup);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OnboardingView", () => {
  it("shows Generate Tour CTA when server returns 404 (no tour yet)", () => {
    const err = new ApiError("No tour generated", 404, "not_found");
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: true,
      error: err,
      data: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    renderView();

    // The EmptyState renders both a title div and a button — use getByRole for specificity
    expect(
      screen.getByRole("button", { name: /generate onboarding tour/i }),
    ).toBeInTheDocument();
    // No error boundary — just a friendly empty state CTA
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows 5 section headings when tour data is loaded", () => {
    const tour = makeTour();
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: tour,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    renderView();

    for (const title of EXPECTED_SECTION_TITLES) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it("shows headings in exact order — kind-string drift safety net", () => {
    const tour = makeTour();
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: tour,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    renderView();

    const headings = screen.getAllByRole("heading", { level: 2 });
    const renderedTitles = headings.map((h) => h.textContent);
    expect(renderedTitles).toEqual(EXPECTED_SECTION_TITLES as unknown as string[]);
  });

  it("shows degraded notice banner when tour has degraded: true", () => {
    const tour = makeTour({ degraded: true });
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: tour,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    renderView();

    expect(
      screen.getByText(
        "Tour generated from limited index data — some sections may be incomplete.",
      ),
    ).toBeInTheDocument();
  });

  it("shows Settings link (not error boundary) when generate error code is no_llm_key", () => {
    // 404 = no tour yet, triggers generate flow
    const queryErr = new ApiError("Not found", 404, "not_found");
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: true,
      error: queryErr,
      data: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    const generateErr = new ApiError(
      "No model key is configured",
      503,
      "no_llm_key",
    );
    mockUseGenerateOnboarding.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: generateErr,
    } as unknown as ReturnType<typeof useGenerateOnboarding>);

    renderView();

    const link = screen.getByRole("link", { name: "Go to API Keys" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/settings/api-keys");
  });

  it("shows Generating… label and disables CTA while generate is pending", async () => {
    const queryErr = new ApiError("Not found", 404, "not_found");
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: true,
      error: queryErr,
      data: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    mockUseGenerateOnboarding.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGenerateOnboarding>);

    renderView();

    // The CTA button shows the pending label
    expect(screen.getByText("Generating…")).toBeInTheDocument();
  });

  it("displays generatedAt timestamp when tour is loaded", () => {
    const tour = makeTour();
    mockUseOnboardingTour.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: tour,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOnboardingTour>);

    renderView();

    // The timestamp is rendered via toLocaleString — just check the prefix text
    const el = screen.getByText((text) => text.startsWith("Last generated"));
    expect(el).toBeInTheDocument();
  });
});
