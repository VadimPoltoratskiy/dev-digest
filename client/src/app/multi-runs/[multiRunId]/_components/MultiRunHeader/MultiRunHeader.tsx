/* MultiRunHeader — breadcrumb, Configure run link, Columns/Tabs toggle, summary line. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { s } from "./styles";

export interface MultiRunHeaderProps {
  prId: string;
  prNumber: number | null | undefined;
  agentCount: number;
  allComplete: boolean;
  totalDurationMs: number | null;
  totalCostUsd: number | null;
  viewMode: "columns" | "tabs";
  onViewModeChange: (mode: "columns" | "tabs") => void;
}

export function MultiRunHeader({
  prId,
  prNumber,
  agentCount,
  allComplete,
  totalDurationMs,
  totalCostUsd,
  viewMode,
  onViewModeChange,
}: MultiRunHeaderProps) {
  const t = useTranslations("multiRuns");

  const durationS =
    totalDurationMs != null ? (totalDurationMs / 1000).toFixed(1) : null;
  const cost =
    totalCostUsd != null ? totalCostUsd.toFixed(2) : null;

  const summaryLine =
    allComplete && durationS != null && cost != null
      ? t("results.summaryComplete", { count: agentCount, duration: durationS, cost })
      : t("results.summaryRunning", { count: agentCount });

  return (
    <div style={s.header}>
      <div style={s.topRow}>
        <div style={s.breadcrumb}>
          {prNumber != null
            ? t("results.breadcrumb", { number: prNumber })
            : t("results.title")}
        </div>

        <div style={s.actions}>
          <Link href={`/multi-runs/configure?prId=${prId}`} style={s.configLink}>
            {t("results.configureRun")}
          </Link>

          <div style={s.toggle} role="group" aria-label="View mode">
            <button
              type="button"
              aria-pressed={viewMode === "columns"}
              onClick={() => onViewModeChange("columns")}
              style={viewMode === "columns" ? s.toggleBtnActive : s.toggleBtn}
            >
              {t("results.columnsMode")}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "tabs"}
              onClick={() => onViewModeChange("tabs")}
              style={viewMode === "tabs" ? s.toggleBtnActive : s.toggleBtn}
            >
              {t("results.tabsMode")}
            </button>
          </div>
        </div>
      </div>

      <div style={s.summary}>{summaryLine}</div>
    </div>
  );
}
