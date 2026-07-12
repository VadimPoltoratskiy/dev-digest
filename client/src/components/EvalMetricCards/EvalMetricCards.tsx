/* EvalMetricCards — recall/precision/citation-accuracy KPI row, using the
   vendored @devdigest/ui MetricCard (+ optional sparkline). Shared by the
   workspace eval dashboard and the per-agent eval dashboard. */
"use client";

import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";

export function EvalMetricCards({
  current,
  delta,
  recallTrend,
  precisionTrend,
  citationTrend,
}: {
  current: EvalDashboard["current"];
  delta: EvalDashboard["delta"];
  recallTrend?: number[];
  precisionTrend?: number[];
  citationTrend?: number[];
}) {
  const t = useTranslations("eval");

  return (
    <div style={{ display: "flex", gap: 12 }}>
      <MetricCard
        label={t("dashboard.metrics.recall")}
        value={(current.recall * 100).toFixed(1)}
        suffix="%"
        delta={delta.recall}
        trend={recallTrend}
        color="var(--accent, #4f46e5)"
      />
      <MetricCard
        label={t("dashboard.metrics.precision")}
        value={(current.precision * 100).toFixed(1)}
        suffix="%"
        delta={delta.precision}
        trend={precisionTrend}
        color="var(--ok)"
      />
      <MetricCard
        label={t("dashboard.metrics.citationAccuracy")}
        value={(current.citation_accuracy * 100).toFixed(1)}
        suffix="%"
        delta={delta.citation_accuracy}
        trend={citationTrend}
        color="#8b5cf6"
      />
    </div>
  );
}
