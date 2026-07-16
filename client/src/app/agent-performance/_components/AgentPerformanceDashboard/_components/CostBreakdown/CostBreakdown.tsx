"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Donut } from "@devdigest/ui";
import type { AgentCostBreakdown, ModelCostBreakdown } from "@devdigest/shared";
import { AGENT_COLORS, MODEL_COLORS } from "../../constants";

export function CostBreakdown({
  costByAgent,
  costByModel,
  totalCostUsd,
}: {
  costByAgent: AgentCostBreakdown[];
  costByModel: ModelCostBreakdown[];
  totalCostUsd: number | null;
}) {
  const t = useTranslations("agentPerformance");

  const agentSegments = costByAgent.map((a, i) => ({
    label: a.agent_name,
    value: a.cost_usd,
    color: AGENT_COLORS[i % AGENT_COLORS.length] ?? "#6366f1",
  }));

  const modelSegments = costByModel.map((m, i) => ({
    label: m.model,
    value: m.cost_usd,
    color: MODEL_COLORS[i % MODEL_COLORS.length] ?? "#3b82f6",
  }));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 20,
      }}
    >
      {/* Cost by agent */}
      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          {t("costByAgent")}
        </div>
        {totalCostUsd === null || agentSegments.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noCost")}</p>
        ) : (
          <Donut segments={agentSegments} valuePrefix="$" />
        )}
      </div>

      {/* Cost by model */}
      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          {t("costByModel")}
        </div>
        {totalCostUsd === null || modelSegments.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noCost")}</p>
        ) : (
          <Donut segments={modelSegments} valuePrefix="$" />
        )}
      </div>
    </div>
  );
}
