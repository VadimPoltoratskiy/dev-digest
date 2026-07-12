/* EvalCompareView — metric deltas + case-flip table between two eval batches.
   Shared by the Agent Editor's Evals tab and the per-agent eval dashboard. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import { useAgentEvalRunsCompare } from "../../lib/hooks";
import { fmtDelta, fmtCostDelta } from "../../lib/eval-format";

export function EvalCompareView({
  agentId,
  runA,
  runB,
  onBack,
}: {
  agentId: string;
  runA: string;
  runB: string;
  onBack: () => void;
}) {
  const t = useTranslations("eval");
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
      {compare.isError && <ErrorState body={t("evalsTab.errorCompare")} />}

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
                  ["recall", t("evalsTab.deltaRecall"), fmtDelta(compare.data.deltas.recall, t("evalsTab.na"))],
                  [
                    "precision",
                    t("evalsTab.deltaPrecision"),
                    fmtDelta(compare.data.deltas.precision, t("evalsTab.na")),
                  ],
                  [
                    "citation",
                    t("evalsTab.deltaCitation"),
                    fmtDelta(compare.data.deltas.citation_accuracy, t("evalsTab.na")),
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
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("evalsTab.noFlips")}</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
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
                    <tr key={flip.case_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px" }}>{flip.case_name}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {flip.from_pass ? (
                          <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} aria-label={t("evalsTab.passed")} />
                        ) : (
                          <Icon.XCircle size={16} style={{ color: "var(--crit)" }} aria-label={t("evalsTab.failed")} />
                        )}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {flip.to_pass ? (
                          <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} aria-label={t("evalsTab.passed")} />
                        ) : (
                          <Icon.XCircle size={16} style={{ color: "var(--crit)" }} aria-label={t("evalsTab.failed")} />
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
