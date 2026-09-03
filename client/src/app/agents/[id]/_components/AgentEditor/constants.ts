import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Config + Skills + Context + Evals + CI + Stats are implemented. */
export const TABS: readonly EditorTab[] = [
  { key: "config",  labelKey: "editor.tabs.config",  icon: "Settings" },
  { key: "skills",  labelKey: "editor.tabs.skills",  icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals",   labelKey: "editor.tabs.evals",   icon: "FlaskConical" },
  { key: "ci",      labelKey: "editor.tabs.ci",      icon: "GitBranch" },
  { key: "stats",   labelKey: "editor.tabs.stats",   icon: "BarChart" },
];
