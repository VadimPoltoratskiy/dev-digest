import type { SkillType } from "@devdigest/shared";

/** Color map for skill type badges — shared between skills pages and agent editor. */
export const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "#10b981",
  security: "#ef4444",
  custom: "var(--text-secondary)",
};
