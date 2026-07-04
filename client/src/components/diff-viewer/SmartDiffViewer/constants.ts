import type { SmartDiffRole } from "@/lib/types";

/** Label + one-line hint per risk role, and whether the group starts collapsed. */
export const ROLE_META: Record<SmartDiffRole, { label: string; hint: string; collapsedByDefault: boolean }> = {
  core: {
    label: "Core logic",
    hint: "The substance of the change — review closely",
    collapsedByDefault: false,
  },
  wiring: {
    label: "Wiring",
    hint: "Hooks the core into the app",
    collapsedByDefault: false,
  },
  boilerplate: {
    label: "Boilerplate",
    hint: "Generated / mechanical — skim",
    collapsedByDefault: true,
  },
};

export const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];
