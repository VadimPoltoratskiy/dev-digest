/* MultiRunResultsView — orchestrator for the Multi-Agent Review results page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useMultiRun, useMultiRunFindings } from "@/lib/hooks/multi-runs";
import { useRunEvents } from "@/lib/hooks/reviews";
import RunTraceDrawer from "@/components/RunTraceDrawer";
import { AppShell } from "@/components/app-shell";
import { MultiRunHeader } from "../MultiRunHeader";
import { ColumnsView } from "../ColumnsView";
import { TabsView } from "../TabsView";
import { ConflictsSection } from "../ConflictsSection";
import { s } from "./styles";

export interface MultiRunResultsViewProps {
  multiRunId: string;
}

export function MultiRunResultsView({ multiRunId }: MultiRunResultsViewProps) {
  const t = useTranslations("multiRuns");
  const qc = useQueryClient();

  const crumb = [{ label: "Multi-Agent Review", href: "/multi-runs" }];

  // ---- Data fetching --------------------------------------------------------
  const {
    data: multiRun,
    isLoading: runLoading,
    isError: runError,
    refetch: refetchRun,
  } = useMultiRun(multiRunId);

  const { data: findings, isLoading: findingsLoading } =
    useMultiRunFindings(multiRunId);

  // ---- Live SSE streaming ---------------------------------------------------
  const activeRunIds = React.useMemo(
    () =>
      (multiRun?.agents ?? [])
        .filter((a) => a.status === "running")
        .map((a) => a.run_id),
    [multiRun],
  );

  const { events, running: sseRunning } = useRunEvents(activeRunIds);

  // Derive per-run-id last SSE event kind for live status display.
  const sseStatuses = React.useMemo(() => {
    const result: Record<string, string> = {};
    for (const ev of events) {
      result[ev.runId] = ev.kind;
    }
    return result;
  }, [events]);

  // When all SSE streams close (all agents done or failed), refresh the run record.
  const prevRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (prevRunningRef.current && !sseRunning) {
      void qc.invalidateQueries({ queryKey: ["multi-run", multiRunId] });
    }
    prevRunningRef.current = sseRunning;
  }, [sseRunning, qc, multiRunId]);

  // ---- Local UI state -------------------------------------------------------
  const [viewMode, setViewMode] = React.useState<"columns" | "tabs">("columns");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);
  const [openTraceRunId, setOpenTraceRunId] = React.useState<string | null>(null);
  const [openTraceAgentName, setOpenTraceAgentName] = React.useState<
    string | null
  >(null);

  const handleViewTrace = (runId: string, agentName: string | null) => {
    setOpenTraceRunId(runId);
    setOpenTraceAgentName(agentName);
  };

  const handleCloseTrace = () => {
    setOpenTraceRunId(null);
    setOpenTraceAgentName(null);
  };

  // ---- Derived data ---------------------------------------------------------
  const agents = multiRun?.agents ?? [];
  const allComplete = agents.length > 0 && agents.every((a) => a.status !== "running");
  const agentFindings = findings?.agents ?? [];
  const groups = findings?.groups ?? [];

  // ---- Loading state --------------------------------------------------------
  if (runLoading || findingsLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.loadingWrap}>
            <div
              style={{
                height: 32,
                background: "var(--bg-elevated)",
                borderRadius: 6,
                width: "60%",
              }}
            />
            <div
              style={{
                height: 20,
                background: "var(--bg-elevated)",
                borderRadius: 6,
                width: "40%",
              }}
            />
            <div
              style={{
                height: 200,
                background: "var(--bg-elevated)",
                borderRadius: 8,
              }}
            />
          </div>
        </div>
      </AppShell>
    );
  }

  // ---- Error state ----------------------------------------------------------
  if (runError || !multiRun) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.errorWrap}>
            <div>{t("results.title")}</div>
            <div>{t("results.loadError")}</div>
            <button type="button" style={s.retryBtn} onClick={() => void refetchRun()}>
              {t("results.retry")}
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ---- Normal render --------------------------------------------------------
  return (
    <AppShell crumb={crumb}>
    <div style={s.page}>
      <MultiRunHeader
        prId={multiRun.pr_id}
        prNumber={multiRun.pr_number}
        prTitle={multiRun.pr_title}
        agentCount={agents.length}
        allComplete={allComplete}
        totalDurationMs={multiRun.total_duration_ms}
        totalCostUsd={multiRun.total_cost_usd}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === "columns" ? (
        <ColumnsView
          agents={agents}
          agentFindings={agentFindings}
          sseStatuses={sseStatuses}
          onViewTrace={handleViewTrace}
        />
      ) : (
        <TabsView
          agents={agents}
          agentFindings={agentFindings}
          sseStatuses={sseStatuses}
          onViewTrace={handleViewTrace}
          prId={multiRun.pr_id}
          multiRunId={multiRunId}
        />
      )}

      <ConflictsSection
        groups={groups}
        showOnlyConflicts={showOnlyConflicts}
        onToggle={() => setShowOnlyConflicts((v) => !v)}
        allAgentCount={agents.length}
      />

      {openTraceRunId != null && (
        <RunTraceDrawer
          runId={openTraceRunId}
          agentName={openTraceAgentName}
          onClose={handleCloseTrace}
        />
      )}
    </div>
    </AppShell>
  );
}
