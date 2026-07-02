import type { Skill } from "@devdigest/shared";

/** Filter skills by name or description against a search string. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase().trim();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q),
  );
}
