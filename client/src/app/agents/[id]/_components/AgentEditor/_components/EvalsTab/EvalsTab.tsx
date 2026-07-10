/* EvalsTab — Agent eval case list, run history, two-run compare.
   Presentational logic: case list with kind/name/pass-fail, run history
   grouped by ran_at, compare selection, metric deltas + flip list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import type { EvalRunRecord, AgentEvalCase } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useDeleteAgentEvalCase,
  useRunAgentEvalBatch,
  useAgentEvalRuns,
  useAgentEvalRunsCompare,
} from "../../../../../../../lib/hooks";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

type Tran = ReturnType<typeof useTranslations<"eval">>;

function fmtMetric(v: number | null | undefined, t: Tran): string {
  if (v == null) return t("evalsTab.na");
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number | null | undefined, t: Tran): string {
  if (v == null) return t("evalsTab.na");
  const pct = (v * 100).toFixed(1);
  return v >= 0 ? `+${pct}%` : `${pct}%`;
}

function fmtCost(v: number | null | undefined, empty: string): string {
  if (v == null) return empty;
  return `$${v.toFixed(4)}`;
}

function fmtCostDelta(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  if (v >= 0) return `+$${v.toFixed(4)}`;
  return `-$${Math.abs(v).toFixed(4)}`;
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function CaseStatusIcon({ latestRun }: { latestRun: AgentEvalCase["latest_run"] }) {
  const t = useTranslations("eval");
  if (latestRun == null) {
    return (
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "2px solid var(--border)",
          display: "inline-block",
          flexShrink: 0,
        }}
        role="img"
        aria-label={t("evalsTab.statusNeverRun")}
      />
    );
  }
  if (latestRun.pass === true) {
    return (
      <Icon.CheckCircle
        size={18}
        style={{ color: "var(--ok)", flexShrink: 0 }}
        aria-label={t("evalsTab.statusPassed")}
      />
    );
  }
  if (latestRun.pass === false) {
    return (
      <Icon.XCircle
        size={18}
        style={{ color: "var(--crit)", flexShrink: 0 }}
        aria-label={t("evalsTab.statusFailed")}
      />
    );
  }
  return (
    <span style={{ width: 18, height: 18, display: "inline-block", flexShrink: 0 }} />
  );
}

function KindBadge({ kind }: { kind: "must_find" | "must_not_flag" }) {
  const t = useTranslations("eval");
  const color = kind === "must_find" ? "var(--ok)" : "var(--warn)";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `${color}1a`,
        padding: "2px 6px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        flexShrink: 0,
        whiteSpace: "nowrap" as const,
      }}
    >
      {kind === "must_find" ? t("evalsTab.kindMustFind") : t("evalsTab.kindMustNotFlag")}
    </span>
  );
}

// --------------------------------------------------------------------------
// Compare view
// --------------------------------------------------------------------------

interface CompareViewProps {
  agentId: string;
  runA: string;
  runB: string;
  onBack: () => void;
  t: Tran;
}

function CompareView({ agentId, runA, runB, onBack, t }: CompareViewProps) {
  const compare = useAgentEvalRunsCompare(agentId, runA, runB);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button kind="ghost" size="sm" icon="ChevronLeft" onClick={onBack}>
          {t("evalsTab.back")}
        </Button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t("evalsTab.compareTitle")}</span>
      </div>

      {compare.isLoading && <Skeleton height={200} />}
      {compare.isError && (
        <ErrorState body={t("evalsTab.errorCompare")} />
      )}

      {compare.data && (
        <>
          {/* Metric deltas */}
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 10,
                color: "var(--text-secondary)",
              }}
            >
              {t("evalsTab.deltaMetrics")}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}
            >
              {(
                [
                  [
                    "recall",
                    t("evalsTab.deltaRecall"),
                    fmtDelta(compare.data.deltas.recall, t),
                  ],
                  [
                    "precision",
                    t("evalsTab.deltaPrecision"),
                    fmtDelta(compare.data.deltas.precision, t),
                  ],
                  [
                    "citation",
                    t("evalsTab.deltaCitation"),
                    fmtDelta(compare.data.deltas.citation_accuracy, t),
                  ],
                  [
                    "cost",
                    t("evalsTab.deltaCost"),
                    fmtCostDelta(compare.data.deltas.cost_usd, t("evalsTab.na")),
                  ],
                ] as const
              ).map(([key, label, value]) => (
                <div
                  key={key}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    padding: "10px 12px",
                    background: "var(--bg-elevated)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.04em",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Flips table */}
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 8,
                color: "var(--text-secondary)",
              }}
            >
              {t("evalsTab.flips")}
            </div>
            {compare.data.flips.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("evalsTab.noFlips")}
              </p>
            ) : (
              <table
                style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}
              >
                <thead>
                  <tr>
                    {(
                      [
                        ["caseName", "left"],
                        ["before", "center"],
                        ["after", "center"],
                      ] as const
                    ).map(([key, align]) => (
                      <th
                        key={key}
                        style={{
                          textAlign: align,
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          fontWeight: 600,
                        }}
                      >
                        {t(`evalsTab.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compare.data.flips.map((flip) => (
                    <tr
                      key={flip.case_id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: "6px 8px" }}>{flip.case_name}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {flip.from_pass ? (
                          <Icon.CheckCircle
                            size={16}
                            style={{ color: "var(--ok)" }}
                            aria-label={t("evalsTab.passed")}
                          />
                        ) : (
                          <Icon.XCircle
                            size={16}
                            style={{ color: "var(--crit)" }}
                            aria-label={t("evalsTab.failed")}
                          />
                        )}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {flip.to_pass ? (
                          <Icon.CheckCircle
                            size={16}
                            style={{ color: "var(--ok)" }}
                            aria-label={t("evalsTab.passed")}
                          />
                        ) : (
                          <Icon.XCircle
                            size={16}
                            style={{ color: "var(--crit)" }}
                            aria-label={t("evalsTab.failed")}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");

  const {
    data: cases,
    isLoading: casesLoading,
    isError: casesError,
  } = useAgentEvalCases(agentId);
  const { data: runs } = useAgentEvalRuns(agentId);
  const deleteCase = useDeleteAgentEvalCase(agentId);
  const runBatch = useRunAgentEvalBatch(agentId);

  // Compare selection — at most 2 ran_at ISO strings
  const [selectedRuns, setSelectedRuns] = React.useState<Set<string>>(new Set());
  const [compareA, setCompareA] = React.useState<string | null>(null);
  const [compareB, setCompareB] = React.useState<string | null>(null);
  const [showCompare, setShowCompare] = React.useState(false);

  // Group runs by ran_at (newest first, one representative row per batch)
  const batchHistory = React.useMemo((): EvalRunRecord[] => {
    if (!runs) return [];
    const seen = new Set<string>();
    const unique: EvalRunRecord[] = [];
    for (const r of runs) {
      if (!seen.has(r.ran_at)) {
        seen.add(r.ran_at);
        unique.push(r);
      }
    }
    return unique.sort((a, b) => b.ran_at.localeCompare(a.ran_at));
  }, [runs]);

  const total = cases?.length ?? 0;

  const handleRunToggle = (ranAt: string) => {
    setSelectedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(ranAt)) {
        next.delete(ranAt);
      } else if (next.size < 2) {
        next.add(ranAt);
      } else {
        // Replace the older of the two selections
        const [oldest] = Array.from(next).sort();
        if (oldest) next.delete(oldest);
        next.add(ranAt);
      }
      return next;
    });
  };

  const handleCompare = () => {
    const sorted = Array.from(selectedRuns).sort();
    if (sorted.length !== 2) return;
    setCompareA(sorted[0]!);
    setCompareB(sorted[1]!);
    setShowCompare(true);
  };

  const handleBack = () => {
    setShowCompare(false);
    setCompareA(null);
    setCompareB(null);
    setSelectedRuns(new Set());
  };

  if (showCompare && compareA && compareB) {
    return (
      <CompareView
        agentId={agentId}
        runA={compareA}
        runB={compareB}
        onBack={handleBack}
        t={t}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ---------------------------------------------------------------- */}
      {/* Case list section                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
            {t("evalsTab.casesHeading")}
          </span>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={runBatch.isPending}
            onClick={() => runBatch.mutate()}
          >
            {runBatch.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
        </div>

        {casesLoading && <Skeleton height={100} />}
        {casesError && <ErrorState body={t("evalsTab.errorCases")} />}

        {!casesLoading && !casesError && total === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("evalsTab.emptyCases")}
          </p>
        )}

        {cases && cases.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cases.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-elevated)",
                }}
              >
                <CaseStatusIcon latestRun={c.latest_run} />
                <KindBadge kind={c.expected_output.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {c.latest_run == null
                      ? t("evalsTab.neverRun")
                      : c.latest_run.pass === true
                      ? t("evalsTab.passed")
                      : c.latest_run.pass === false
                      ? t("evalsTab.failed")
                      : t("evalsTab.neverRun")}
                  </div>
                </div>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Trash"
                  aria-label={t("evalsTab.delete")}
                  disabled={deleteCase.isPending}
                  onClick={() => deleteCase.mutate(c.id)}
                >
                  {t("evalsTab.delete")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Run history section                                               */}
      {/* ---------------------------------------------------------------- */}
      {batchHistory.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
              {t("evalsTab.runHistory")}
            </span>
            {selectedRuns.size === 2 && (
              <Button
                kind="secondary"
                size="sm"
                icon="BarChart"
                onClick={handleCompare}
              >
                {t("evalsTab.compare")}
              </Button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {batchHistory.map((row) => {
              const isSelected = selectedRuns.has(row.ran_at);
              return (
                <div
                  key={row.ran_at}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => handleRunToggle(row.ran_at)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      handleRunToggle(row.ran_at);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    border: `1px solid ${isSelected ? "var(--accent, #4f46e5)" : "var(--border)"}`,
                    borderRadius: 7,
                    background: isSelected
                      ? "var(--accent-bg, #ede9fe)"
                      : "var(--bg-elevated)",
                    cursor: "pointer",
                    userSelect: "none" as const,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {new Date(row.ran_at).toLocaleString()}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexShrink: 0,
                      flexWrap: "wrap" as const,
                    }}
                  >
                    <MetricCell
                      label={t("dashboard.table.recall")}
                      value={fmtMetric(row.recall, t)}
                    />
                    <MetricCell
                      label={t("dashboard.table.precision")}
                      value={fmtMetric(row.precision, t)}
                    />
                    <MetricCell
                      label={t("dashboard.table.citation")}
                      value={fmtMetric(row.citation_accuracy, t)}
                    />
                    <MetricCell
                      label={t("dashboard.table.cost")}
                      value={fmtCost(row.cost_usd, t("evalsTab.costEmpty"))}
                      plain
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {selectedRuns.size === 1 && (
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 6,
              }}
            >
              {t("evalsTab.selectTwoRuns")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// MetricCell — labelled metric value badge used in the run history row
// --------------------------------------------------------------------------

function MetricCell({
  label,
  value,
  plain,
}: {
  label: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      {plain ? (
        <span style={{ fontSize: 12 }}>{value}</span>
      ) : (
        <Badge>{value}</Badge>
      )}
    </div>
  );
}
