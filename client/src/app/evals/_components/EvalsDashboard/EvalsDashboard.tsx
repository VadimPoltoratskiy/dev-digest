/* EvalsDashboard — workspace-level eval metrics page.
   Shows total case count, current batch metrics, delta vs prior batch,
   trend, and recent run records. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState } from "@devdigest/ui";
import { useEvalsDashboard } from "../../../../lib/hooks";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number): string {
  const pct = (v * 100).toFixed(1);
  return v >= 0 ? `+${pct}%` : `${pct}%`;
}

function fmtCost(v: number | null | undefined, empty: string): string {
  if (v == null) return empty;
  return `$${v.toFixed(4)}`;
}

// --------------------------------------------------------------------------
// Metric card
// --------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {delta != null && (
        <div
          style={{
            fontSize: 12,
            color:
              delta.startsWith("+") ? "var(--ok)" : delta.startsWith("-") ? "var(--crit)" : "var(--text-muted)",
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function EvalsDashboard() {
  const t = useTranslations("eval");
  const { data, isLoading, isError } = useEvalsDashboard();

  if (isLoading) {
    return (
      <div style={{ padding: 32 }}>
        <Skeleton height={300} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 32 }}>
        <ErrorState body={t("dashboard.loading")} />
      </div>
    );
  }

  if (!data) return null;

  const hasRuns = data.recent_runs.length > 0;

  return (
    <div
      style={{
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 900,
      }}
    >
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          {t("dashboard.defaultTitle")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("dashboard.casesSummary", {
            count: data.cases_total,
            runs: data.recent_runs.length,
          })}
        </p>
      </div>

      {!hasRuns ? (
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
          {t("dashboard.noRuns")}
        </p>
      ) : (
        <>
          {/* Current batch metrics */}
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
              }}
            >
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={fmtPct(data.current.recall)}
                delta={fmtDelta(data.delta.recall)}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={fmtPct(data.current.precision)}
                delta={fmtDelta(data.delta.precision)}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={fmtPct(data.current.citation_accuracy)}
                delta={fmtDelta(data.delta.citation_accuracy)}
              />
            </div>
            {/* Supplemental metrics row */}
            <div
              style={{
                display: "flex",
                gap: 16,
                marginTop: 10,
                flexWrap: "wrap" as const,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              <span>
                {t("dashboard.table.pass")}: {data.current.traces_passed}/
                {data.current.traces_total}
              </span>
              <span>
                {t("dashboard.table.cost")}: {fmtCost(data.current.cost_usd, t("evalsTab.costEmpty"))}
              </span>
            </div>
          </div>

          {/* Trend section */}
          {data.trend.length > 0 && (
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 10,
                }}
              >
                {t("dashboard.metricTrend")}
              </div>
              <div style={{ overflowX: "auto" as const }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse" as const,
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "dashboard.table.ranAt",
                        "dashboard.table.recall",
                        "dashboard.table.precision",
                        "dashboard.table.citation",
                        "dashboard.table.cost",
                      ].map((key) => (
                        <th
                          key={key}
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: "1px solid var(--border)",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                            whiteSpace: "nowrap" as const,
                          }}
                        >
                          {t(key as Parameters<typeof t>[0])}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((point) => (
                      <tr
                        key={point.ran_at}
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td
                          style={{
                            padding: "6px 8px",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                        >
                          {new Date(point.ran_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {fmtPct(point.recall)}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {fmtPct(point.precision)}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {fmtPct(point.citation_accuracy)}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {fmtCost(point.cost_usd, t("evalsTab.costEmpty"))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent runs section */}
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 10,
              }}
            >
              {t("dashboard.recentRuns")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.recent_runs.map((run) => (
                <div
                  key={run.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    background: "var(--bg-elevated)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {run.case_name && (
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                          marginBottom: 2,
                        }}
                      >
                        {run.case_name}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 11,
                        fontFamily: "monospace",
                        color: "var(--text-muted)",
                      }}
                    >
                      {new Date(run.ran_at).toLocaleString()}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.recall")}
                    </span>
                    <Badge>
                      {run.recall != null ? fmtPct(run.recall) : t("evalsTab.na")}
                    </Badge>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.precision")}
                    </span>
                    <Badge>
                      {run.precision != null ? fmtPct(run.precision) : t("evalsTab.na")}
                    </Badge>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.citation")}
                    </span>
                    <Badge>
                      {run.citation_accuracy != null
                        ? fmtPct(run.citation_accuracy)
                        : t("evalsTab.na")}
                    </Badge>
                  </div>
                  {run.pass != null && (
                    <Badge
                      color={run.pass ? "var(--ok)" : "var(--crit)"}
                    >
                      {run.pass ? t("dashboard.pass") : t("dashboard.fail")}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
