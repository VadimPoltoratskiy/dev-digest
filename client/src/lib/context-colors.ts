/** Color map for Project Context root badges (specs/docs/insights) — shared
    between the Project Context page and the agent/skill Context tabs. */
export const CONTEXT_ROOT_COLORS: Record<string, string> = {
  specs: "var(--accent)",
  docs: "#10b981",
  insights: "#f59e0b",
};

export function contextRootColor(root: string): string {
  return CONTEXT_ROOT_COLORS[root] ?? "var(--text-secondary)";
}
