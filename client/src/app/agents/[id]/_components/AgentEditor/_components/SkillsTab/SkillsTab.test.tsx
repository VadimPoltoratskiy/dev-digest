import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * Mock all skills hooks before the component module is imported so that
 * vi.mock hoisting takes effect. The component calls these hooks at the
 * top of its body; they must be stubs to render without a QueryClient.
 */
vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useAgentSkills: vi.fn(),
  useSkills: vi.fn(),
  useSetAgentSkills: vi.fn(),
  useLinkSkill: vi.fn(),
  useUnlinkSkill: vi.fn(),
  useToggleSkill: vi.fn(),
}));

import {
  useAgentSkills,
  useSkills,
  useSetAgentSkills,
  useLinkSkill,
  useUnlinkSkill,
  useToggleSkill,
} from "../../../../../../../lib/hooks/skills";
import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINK_1 = { agent_id: "ag1", skill_id: "sk1", order: 0 };
const LINK_2 = { agent_id: "ag1", skill_id: "sk2", order: 1 };

const SKILL_1 = {
  id: "sk1",
  name: "Alpha Skill",
  description: "First skill",
  type: "rubric" as const,
  source: "manual" as const,
  body: "## rule",
  enabled: true,
  version: 1,
  evidence_files: null,
  context_docs: [],
};

const SKILL_2 = {
  id: "sk2",
  name: "Beta Skill",
  description: "Second skill",
  type: "security" as const,
  source: "manual" as const,
  body: "## rule 2",
  enabled: true,
  version: 1,
  evidence_files: null,
  context_docs: [],
};

// ---------------------------------------------------------------------------
// Default mock setup — override per test as needed
// ---------------------------------------------------------------------------

function setupDefaultMocks(mockMutate = vi.fn()) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAgentSkills).mockReturnValue({ data: [LINK_1, LINK_2], isLoading: false, isError: false, refetch: vi.fn() } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useSkills).mockReturnValue({ data: [SKILL_1, SKILL_2] } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useSetAgentSkills).mockReturnValue({ mutate: mockMutate, isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useLinkSkill).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUnlinkSkill).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useToggleSkill).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  return mockMutate;
}

beforeEach(() => {
  setupDefaultMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillsTab — drag-and-drop reorder", () => {
  it("calls setSkills.mutate with reversed order when row 0 is dragged onto row 1", () => {
    const mockMutate = vi.fn();
    setupDefaultMocks(mockMutate);

    render(<SkillsTab agentId="ag1" />);

    // Both skill names must be visible (sorted by order).
    expect(screen.getByText("Alpha Skill")).toBeInTheDocument();
    expect(screen.getByText("Beta Skill")).toBeInTheDocument();

    // Find the draggable row containers via skill name text.
    const row0 = screen.getByText("Alpha Skill").closest("[draggable]") as HTMLElement;
    const row1 = screen.getByText("Beta Skill").closest("[draggable]") as HTMLElement;
    expect(row0).not.toBeNull();
    expect(row1).not.toBeNull();

    // Simulate drag-and-drop: start on row 0, over and drop on row 1.
    fireEvent.dragStart(row0);
    fireEvent.dragOver(row1);
    fireEvent.drop(row1);

    // After drop: sk1 removed from index 0 and inserted at index 1 → [sk2, sk1].
    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk2", "sk1"] });
  });

  it("is a no-op when a row is dropped onto itself", () => {
    const mockMutate = vi.fn();
    setupDefaultMocks(mockMutate);

    render(<SkillsTab agentId="ag1" />);

    const row0 = screen.getByText("Alpha Skill").closest("[draggable]") as HTMLElement;

    fireEvent.dragStart(row0);
    fireEvent.dragOver(row0);
    fireEvent.drop(row0);

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("resets drag state on dragEnd without a drop", () => {
    const mockMutate = vi.fn();
    setupDefaultMocks(mockMutate);

    render(<SkillsTab agentId="ag1" />);

    const row0 = screen.getByText("Alpha Skill").closest("[draggable]") as HTMLElement;
    const row1 = screen.getByText("Beta Skill").closest("[draggable]") as HTMLElement;

    fireEvent.dragStart(row0);
    fireEvent.dragOver(row1);
    // Drag ends without dropping (e.g. dropped outside a target).
    fireEvent.dragEnd(row0);

    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe("SkillsTab — up/down arrow buttons still render", () => {
  it("renders Move up and Move down buttons for both rows", () => {
    setupDefaultMocks();

    render(<SkillsTab agentId="ag1" />);

    const upButtons = screen.getAllByLabelText("Move up");
    const downButtons = screen.getAllByLabelText("Move down");

    // Two rows → two of each button.
    expect(upButtons).toHaveLength(2);
    expect(downButtons).toHaveLength(2);

    // First row's up-button is disabled; last row's down-button is disabled.
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[1]).toBeDisabled();
  });

  it("calls setSkills.mutate when Move down is clicked on row 0", () => {
    const mockMutate = vi.fn();
    setupDefaultMocks(mockMutate);

    render(<SkillsTab agentId="ag1" />);

    const downButtons = screen.getAllByLabelText("Move down");
    fireEvent.click(downButtons[0]!);

    // Row 0 (sk1) swaps with row 1 (sk2) → [sk2, sk1].
    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk2", "sk1"] });
  });
});

describe("SkillsTab — drag handles render", () => {
  it("renders a drag handle for each linked row", () => {
    setupDefaultMocks();

    render(<SkillsTab agentId="ag1" />);

    const handles = screen.getAllByLabelText("Drag to reorder");
    expect(handles).toHaveLength(2);
  });
});
