import type { SkillType } from "@devdigest/shared";

const SECURITY_TAGS = new Set(["security", "owasp", "sql", "secrets"]);
const CONVENTION_TAGS = new Set(["frontend", "react", "a11y"]);

/**
 * Derives SkillType from a CommunitySkillEntry's tags array.
 * Precedence (AC-3): security → convention → custom.
 * Never returns 'rubric' — that type is reserved for manually authored skills.
 */
export function tagToType(tags: string[]): SkillType {
  if (tags.some((t) => SECURITY_TAGS.has(t))) return "security";
  if (tags.some((t) => CONVENTION_TAGS.has(t))) return "convention";
  return "custom";
}

/**
 * Crude token estimate (~4 chars per token) — mirrors the server's estimate for
 * the file/URL preview so the community path shows a consistent count client-side.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
