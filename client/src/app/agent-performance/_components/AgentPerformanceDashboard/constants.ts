/* constants.ts — static config for the Agent Performance dashboard. */

export const PERIOD_PRESETS = [
  { value: "30d", labelKey: "period30d" },
  { value: "7d", labelKey: "period7d" },
  { value: "1d", labelKey: "period1d" },
] as const;

/** Color palette for the cost-by-agent donut (10 colors, repeats for 10+ agents). */
export const AGENT_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#64748b",
  "#a16207",
];

/** Color palette for the cost-by-model donut. */
export const MODEL_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#6366f1",
  "#f43f5e",
  "#64748b",
];
