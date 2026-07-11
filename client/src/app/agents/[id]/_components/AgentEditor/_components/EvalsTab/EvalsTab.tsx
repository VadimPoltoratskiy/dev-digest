/* EvalsTab — Agent eval case list, run history, two-run compare.
   Presentational logic: case list with kind/name/pass-fail lives here; run
   history, compare selection, and metric deltas + flip list live in the
   shared EvalRunHistoryTable/EvalCompareView components (also used by the
   per-agent eval dashboard at /evals/[agentId]). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type { AgentEvalCase } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useDeleteAgentEvalCase,
  useRunAgentEvalBatch,
  useAgentEvalRuns,
} from "../../../../../../../lib/hooks";
import { EvalRunHistoryTable } from "../../../../../../../components/EvalRunHistoryTable";
import { EvalCompareView } from "../../../../../../../components/EvalCompareView";

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

  // Compare selection — set by EvalRunHistoryTable once two runs are picked.
  const [compareA, setCompareA] = React.useState<string | null>(null);
  const [compareB, setCompareB] = React.useState<string | null>(null);

  const total = cases?.length ?? 0;

  const handleBack = () => {
    setCompareA(null);
    setCompareB(null);
  };

  if (compareA && compareB) {
    return <EvalCompareView agentId={agentId} runA={compareA} runB={compareB} onBack={handleBack} />;
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
      {/* Run history + compare                                             */}
      {/* ---------------------------------------------------------------- */}
      <EvalRunHistoryTable
        runs={runs ?? []}
        onCompare={(runA, runB) => {
          setCompareA(runA);
          setCompareB(runB);
        }}
      />
    </div>
  );
}
