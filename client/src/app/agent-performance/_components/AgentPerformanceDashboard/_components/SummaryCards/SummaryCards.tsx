"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { AgentPerformanceSummary } from "@devdigest/shared";
import { formatCost, formatAcceptRate, computeDelta } from "../../helpers";

/** Small SVG ring indicator for the accept-rate card (AC-6 accessibility). */
function RingIndicator({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = value * 100;
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg
      width={44}
      height={44}
      role="progressbar"
      aria-valuenow={Math.round(pct * 10) / 10}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${pct.toFixed(1)}%`}
      aria-label={`Accept rate: ${pct.toFixed(1)}%`}
    >
      <circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={4}
      />
      <circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke="var(--ok, #10b981)"
        strokeWidth={4}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
    </svg>
  );
}

export function SummaryCards({ summary }: { summary: AgentPerformanceSummary }) {
  const t = useTranslations("agentPerformance");

  const delta = computeDelta(summary.total_cost_usd, summary.previous_total_cost_usd);

  const runsTrend = summary.runs_trend.map((p) => p.value);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
      }}
    >
      {/* Total runs */}
      <MetricCard
        label={t("summary.totalRuns")}
        value={summary.total_runs}
        trend={runsTrend.length > 1 ? runsTrend : undefined}
        color="var(--accent)"
      />

      {/* Total cost */}
      <div
        style={{
          flex: 1,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: 18,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.03em",
          }}
        >
          {t("summary.totalCost")}
        </span>
        <div style={{ marginTop: 12 }}>
          <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {formatCost(summary.total_cost_usd)}
          </span>
        </div>
        {/* Delta vs previous period — only when prev is not null (AC-8) */}
        {delta !== null && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: delta.dir === "up" ? "var(--crit, #ef4444)" : "var(--ok, #10b981)",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span aria-label={`${delta.dir} ${delta.pct.toFixed(1)}%`}>
              {delta.dir === "up" ? "↑" : "↓"} {delta.pct.toFixed(1)}% vs last period
            </span>
          </div>
        )}
      </div>

      {/* Avg accept rate */}
      <div
        style={{
          flex: 1,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: "0.03em",
            }}
          >
            {t("summary.avgAcceptRate")}
          </span>
          <RingIndicator value={summary.avg_accept_rate} />
        </div>
        <div style={{ marginTop: 12 }}>
          <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {formatAcceptRate(summary.avg_accept_rate)}
          </span>
        </div>
      </div>

      {/* Most active */}
      <div
        style={{
          flex: 1,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: 18,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.03em",
          }}
        >
          {t("summary.mostActive")}
        </span>
        {summary.most_active === null ? (
          <div style={{ marginTop: 12, fontSize: 32, fontWeight: 700 }}>
            {t("summary.noRate")}
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              {summary.most_active.agent_name}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
              {summary.most_active.runs} runs
              {summary.most_active.accept_rate !== null && (
                <span> · {formatAcceptRate(summary.most_active.accept_rate)}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
