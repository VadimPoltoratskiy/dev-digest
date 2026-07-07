import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../messages/en/onboarding.json";

// Mermaid is a heavy browser dependency — mock it to a simple div in tests.
vi.mock("../../../../components/mermaid-diagram", () => ({
  MermaidDiagram: ({
    chart,
    alt,
  }: {
    chart: string;
    alt?: string;
  }) => (
    <figure aria-label={alt}>
      <div data-testid="mermaid-diagram">{chart}</div>
    </figure>
  ),
}));

import { OnboardingSectionCard } from "./OnboardingSectionCard";

afterEach(cleanup);

function makeSection(overrides: Partial<OnboardingSection> = {}): OnboardingSection {
  return {
    kind: "architecture_overview",
    title: "Architecture Overview",
    body: "This is the **architecture** body.",
    diagram: null,
    links: [],
    ...overrides,
  };
}

function renderCard(section: OnboardingSection) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingSectionCard section={section} />
    </NextIntlClientProvider>,
  );
}

describe("OnboardingSectionCard", () => {
  it("renders an <h2> heading with the section title", () => {
    renderCard(makeSection({ title: "Architecture Overview" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Architecture Overview" }),
    ).toBeInTheDocument();
  });

  it("does NOT render a <figure> when diagram is null", () => {
    renderCard(makeSection({ diagram: null }));
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("renders MermaidDiagram when diagram string is provided", () => {
    renderCard(
      makeSection({ diagram: "flowchart LR\n  A --> B" }),
    );
    expect(screen.getByTestId("mermaid-diagram")).toBeInTheDocument();
  });

  it("renders a <ul> with <code> paths when links are present", () => {
    renderCard(
      makeSection({
        links: [
          { path: "src/server.ts", label: "Server entry" },
          { path: "src/routes.ts", label: "Routes" },
        ],
      }),
    );

    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();

    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText("src/routes.ts")).toBeInTheDocument();
  });

  it("does NOT render a link list when links array is empty", () => {
    renderCard(makeSection({ links: [] }));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
