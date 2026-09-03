/* StatsTab — per-agent performance stats (SPEC-10, Phase 2).
   Reads period/from/to from URL search params. Calls useAgentStats for data.
   Shows skeleton while loading, ErrorState on error, and metric grid + severity
   breakdown + trend sparkline when data is available. null accept_rate renders
   "—" never "0%" (AC-16). */
"use client";

import React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { MetricCard, Sparkline, BarRow } from "@devdigest/ui";
import { useAgentStats } from "@/lib/hooks/performance";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRESETS = ["30d", "7d", "1d"] as const;
type Preset = (typeof PRESETS)[number];

function getPresetLabelKey(p: Preset): string {
  if (p === "30d") return "stats.period30d";
  if (p === "7d") return "stats.period7d";
  return "stats.period1d";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const searchParams = useSearchParams();
  const router = useRouter();

  const period = searchParams.get("period") ?? "30d";
  const urlFrom = searchParams.get("from") ?? undefined;
  const urlTo = searchParams.get("to") ?? undefined;

  // Local state for the custom date picker inputs only.
  const [customFrom, setCustomFrom] = React.useState(urlFrom ?? "");
  const [customTo, setCustomTo] = React.useState(urlTo ?? "");

  const isCustom = period === "custom";

  const { data: stats, isLoading, isError } = useAgentStats(agentId, {
    period,
    from: isCustom ? urlFrom : undefined,
    to: isCustom ? urlTo : undefined,
  });

  const noData = t("stats.noData");

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  function setPeriodPreset(p: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "stats");
    sp.set("period", p);
    if (p !== "custom") {
      sp.delete("from");
      sp.delete("to");
    }
    router.replace(`/agents/${agentId}?${sp.toString()}`);
  }

  function applyCustomRange() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "stats");
    sp.set("period", "custom");
    sp.set("from", customFrom);
    sp.set("to", customTo);
    router.replace(`/agents/${agentId}?${sp.toString()}`);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={s.wrap}>
      {/* ------------------------------------------------------------------ */}
      {/* Period selector                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div style={s.periodBar}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => setPeriodPreset(p)}
            style={s.presetBtn(period === p)}
          >
            {t(getPresetLabelKey(p))}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isCustom}
          onClick={() => setPeriodPreset("custom")}
          style={s.presetBtn(isCustom)}
        >
          {t("stats.periodCustom")}
        </button>

        {isCustom && (
          <>
            <label style={s.dateLabel}>
              {t("stats.from")}
              <input
                type="date"
                value={customFrom}
                aria-label={t("stats.from")}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ marginLeft: 4 }}
              />
            </label>
            <label style={s.dateLabel}>
              {t("stats.to")}
              <input
                type="date"
                value={customTo}
                aria-label={t("stats.to")}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ marginLeft: 4 }}
              />
            </label>
            <button
              type="button"
              onClick={applyCustomRange}
              disabled={!customFrom || !customTo || customFrom > customTo}
              style={s.applyBtn}
            >
              {t("stats.apply")}
            </button>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading skeleton — no fake zeros (AC-18)                            */}
      {/* ------------------------------------------------------------------ */}
      {isLoading && (
        <div style={s.skeletonCol}>
          <div style={s.skeletonRow}>
            <Skeleton height={80} />
            <Skeleton height={80} />
            <Skeleton height={80} />
          </div>
          <Skeleton height={80} />
          <Skeleton height={120} />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Error state                                                          */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && isError && (
        <ErrorState body={t("stats.loadError")} />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Data state (handles zero-run case too — all rates show "—" via null) */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && !isError && stats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {stats.runs === 0 && (
            <p style={s.emptyText}>{t("stats.empty")}</p>
          )}

          {/* Metric card grid */}
          <div style={s.metricGrid}>
            <MetricCard label={t("stats.runsLabel")} value={stats.runs} />
            <MetricCard label={t("stats.findingsTotal")} value={stats.findings_total} />
            <MetricCard label={t("stats.accepted")} value={stats.accepted} />
            <MetricCard label={t("stats.dismissed")} value={stats.dismissed} />
            <MetricCard label={t("stats.pending")} value={stats.pending} />
            <MetricCard
              label={t("stats.acceptRate")}
              value={
                stats.accept_rate === null
                  ? noData
                  : `${(stats.accept_rate * 100).toFixed(1)}%`
              }
            />
            <MetricCard
              label={t("stats.dismissRate")}
              value={
                stats.dismiss_rate === null
                  ? noData
                  : `${(stats.dismiss_rate * 100).toFixed(1)}%`
              }
            />
            <MetricCard
              label={t("stats.avgFindingsPerRun")}
              value={
                stats.avg_findings_per_run === null
                  ? noData
                  : stats.avg_findings_per_run.toFixed(1)
              }
            />
            <MetricCard
              label={t("stats.totalCost")}
              value={
                stats.total_cost_usd === null
                  ? noData
                  : `$${stats.total_cost_usd.toFixed(4)}`
              }
            />
            <MetricCard
              label={t("stats.avgCost")}
              value={
                stats.avg_cost_usd === null
                  ? noData
                  : `$${stats.avg_cost_usd.toFixed(4)}`
              }
            />
            <MetricCard
              label={t("stats.avgLatency")}
              value={
                stats.avg_latency_ms === null
                  ? noData
                  : stats.avg_latency_ms < 1000
                  ? `${stats.avg_latency_ms.toFixed(0)}ms`
                  : `${(stats.avg_latency_ms / 1000).toFixed(1)}s`
              }
            />
          </div>

          {/* Severity breakdown — only when there are runs */}
          {stats.runs > 0 && (
            <div>
              <div style={s.sectionLabel}>{t("stats.severityBreakdown")}</div>
              <SeverityBreakdown
                critical={stats.findings_by_severity.CRITICAL}
                warning={stats.findings_by_severity.WARNING}
                suggestion={stats.findings_by_severity.SUGGESTION}
                labels={{
                  critical: t("stats.severityCritical"),
                  warning: t("stats.severityWarning"),
                  suggestion: t("stats.severitySuggestion"),
                }}
              />
            </div>
          )}

          {/* Trend sparkline — only when there are trend points */}
          {stats.runs > 0 && stats.trend.length > 0 && (
            <div>
              <div style={s.sectionLabel}>{t("stats.trend")}</div>
              <div
                role="img"
                aria-label={`${t("stats.trend")}: ${stats.trend
                  .map((p) => `${p.label} ${p.value}`)
                  .join(", ")}`}
              >
                <Sparkline
                  data={stats.trend.map((p) => p.value)}
                  color="var(--accent)"
                  w={300}
                  h={48}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: severity breakdown
// ---------------------------------------------------------------------------

function SeverityBreakdown({
  critical,
  warning,
  suggestion,
  labels,
}: {
  critical: number;
  warning: number;
  suggestion: number;
  labels: { critical: string; warning: string; suggestion: string };
}) {
  const max = Math.max(critical, warning, suggestion, 1);
  return (
    <>
      <BarRow label={labels.critical}   value={critical}   max={max} color="var(--crit)"   suffix={String(critical)} />
      <BarRow label={labels.warning}    value={warning}    max={max} color="var(--warn)"   suffix={String(warning)} />
      <BarRow label={labels.suggestion} value={suggestion} max={max} color="var(--accent)" suffix={String(suggestion)} />
    </>
  );
}
