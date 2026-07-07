/**
 * OnboardingView.ac10.test.tsx
 *
 * Supplement to OnboardingView.test.tsx covering AC-10 only.
 * The existing test suite does not switch the active repo mid-test, so no
 * test verifies that the component re-fetches (different queryKey) and
 * re-renders with a different repo's tour when useActiveRepo changes.
 *
 * AC-10: "WHEN the /onboarding route is loaded, the system shall fetch and
 * display the tour for the repository currently active in the navigation
 * context (the same repo selector used by all other repo-scoped pages)."
 *
 * Verification recipe: "With repo A selected in the nav context, navigate to
 * /onboarding. Verify the tour displayed belongs to repo A. Switch to repo B
 * in the nav context; verify the displayed tour updates to repo B's content."
 */

// Test intentions:
// 1. OnboardingView (AC-10: active-repo wiring)
//    - happy path: useActiveRepo returns repoId 'repo-a' → useOnboardingTour is called
//      with 'repo-a' and repo A's section bodies are rendered
//    - happy path: useActiveRepo returns repoId 'repo-b' → useOnboardingTour is called
//      with 'repo-b' and repo B's section bodies are rendered
//    - happy path (switch): after re-rendering with a different active repo, the component
//      calls useOnboardingTour with the new repoId and shows the new repo's content
//    - mocks needed: useActiveRepo, useOnboardingTour, useGenerateOnboarding, AppShell, next/link

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import messages from "../../../../../messages/en/onboarding.json";

// ── Module mocks ──────────────────────────────────────────────────────────────

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

// ── Imports after mocks ───────────────────────────────────────────────────────

import { useActiveRepo } from "../../../../lib/repo-context";
import { useOnboardingTour, useGenerateOnboarding } from "../../../../lib/hooks/onboarding";
import { OnboardingView } from "./OnboardingView";

const mockUseActiveRepo = vi.mocked(useActiveRepo);
const mockUseOnboardingTour = vi.mocked(useOnboardingTour);
const mockUseGenerateOnboarding = vi.mocked(useGenerateOnboarding);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SECTION_KINDS = [
  "architecture_overview",
  "critical_paths",
  "how_to_run",
  "reading_order",
  "first_tasks",
] as const;

const SECTION_TITLES = [
  "Architecture Overview",
  "Critical Paths",
  "How to Run Locally",
  "Guided Reading Order",
  "First Tasks",
] as const;

/**
 * Builds a tour fixture with a unique marker in the first section's body
 * so tests can assert which repo's tour is currently displayed.
 */
function makeTourForRepo(repoLabel: string): Onboarding & { generatedAt: string } {
  return {
    sections: SECTION_KINDS.map((kind, i) => ({
      kind,
      title: SECTION_TITLES[i] as string,
      // Unique body content per repo — used as the identifying assertion
      body: `[${repoLabel}] Body for ${SECTION_TITLES[i]}`,
      diagram: null,
      links: [],
    })),
    generatedAt: "2026-07-07T12:00:00.000Z",
  };
}

const tourA = makeTourForRepo("repo-A");
const tourB = makeTourForRepo("repo-B");

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultGenerateMock(): ReturnType<typeof useGenerateOnboarding> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useGenerateOnboarding>;
}

function makeActiveRepo(repoId: string): ReturnType<typeof useActiveRepo> {
  return {
    repoId,
    repos: [],
    activeRepo: null,
    setRepoId: vi.fn(),
    reposLoaded: true,
  } as unknown as ReturnType<typeof useActiveRepo>;
}

function makeTourQuery(
  data: (Onboarding & { generatedAt: string }) | undefined,
): ReturnType<typeof useOnboardingTour> {
  return {
    isLoading: false,
    isError: false,
    error: null,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useOnboardingTour>;
}

/**
 * Returns the JSX tree used for both initial render and rerender.
 * Keeping the exact same element tree prevents key-diff teardowns during rerender.
 */
function viewElement() {
  return (
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingView />
    </NextIntlClientProvider>
  );
}

// ── Test setup / teardown ────────────────────────────────────────────────────

beforeEach(() => {
  // Default: generate mutation is idle
  mockUseGenerateOnboarding.mockReturnValue(defaultGenerateMock());
});

afterEach(cleanup);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OnboardingView — AC-10: repo-scoped display", () => {
  it("calls useOnboardingTour with the repoId from useActiveRepo (wiring test)", () => {
    mockUseActiveRepo.mockReturnValue(makeActiveRepo("repo-a"));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(tourA));

    render(viewElement());

    // The hook must be invoked with the exact repoId from the active-repo context
    expect(mockUseOnboardingTour).toHaveBeenCalledWith("repo-a");
  });

  it("displays tour A's section bodies when repo A is active", () => {
    mockUseActiveRepo.mockReturnValue(makeActiveRepo("repo-a"));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(tourA));

    render(viewElement());

    // Each section body contains the [repo-A] marker
    expect(screen.getByText("[repo-A] Body for Architecture Overview")).toBeInTheDocument();
    expect(screen.getByText("[repo-A] Body for Critical Paths")).toBeInTheDocument();
  });

  it("displays tour B's section bodies when repo B is active (independent render)", () => {
    mockUseActiveRepo.mockReturnValue(makeActiveRepo("repo-b"));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(tourB));

    render(viewElement());

    expect(screen.getByText("[repo-B] Body for Architecture Overview")).toBeInTheDocument();
    expect(screen.getByText("[repo-B] Body for Critical Paths")).toBeInTheDocument();
    // repo-A content must NOT be present
    expect(
      screen.queryByText("[repo-A] Body for Architecture Overview"),
    ).not.toBeInTheDocument();
  });

  it("updates displayed content when the active repo switches from A to B", () => {
    // ── Phase 1: repo A is active ────────────────────────────────────────────
    mockUseActiveRepo.mockReturnValue(makeActiveRepo("repo-a"));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(tourA));

    const { rerender } = render(viewElement());

    // Repo A content is shown
    expect(screen.getByText("[repo-A] Body for Architecture Overview")).toBeInTheDocument();

    // ── Phase 2: switch active repo to B ────────────────────────────────────
    mockUseActiveRepo.mockReturnValue(makeActiveRepo("repo-b"));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(tourB));

    rerender(viewElement());

    // Repo B content is now shown
    expect(screen.getByText("[repo-B] Body for Architecture Overview")).toBeInTheDocument();
    // Repo A content is gone
    expect(
      screen.queryByText("[repo-A] Body for Architecture Overview"),
    ).not.toBeInTheDocument();

    // useOnboardingTour was called with the new repoId during the rerender
    expect(mockUseOnboardingTour).toHaveBeenCalledWith("repo-b");
  });

  it("calls useOnboardingTour with null when no repo is active (prevents an unintended fetch)", () => {
    mockUseActiveRepo.mockReturnValue(makeActiveRepo(null as unknown as string));
    mockUseOnboardingTour.mockReturnValue(makeTourQuery(undefined));

    render(viewElement());

    // The hook must receive null so its `enabled: !!repoId` guard fires no request
    expect(mockUseOnboardingTour).toHaveBeenCalledWith(null);
  });
});
