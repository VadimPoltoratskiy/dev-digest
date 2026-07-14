/* ColumnsView — horizontal-scrollable per-agent columns. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentRunSummary, MultiRunFindings } from "@devdigest/shared";
import { s } from "./styles";

/** Distinct accent colors for per-agent column left-border coding. */
const AGENT_COLORS = [
  "#6c8ebf",
  "#82b366",
  "#d6a520",
  "#ae4132",
  "#9c5caf",
  "#d98c3e",
];

export interface ColumnsViewProps {
  agents: AgentRunSummary[];
  agentFindings: MultiRunFindings["agents"];
  sseStatuses: Record<string, string>;
  onViewTrace: (runId: string, agentName: string | null) => void;
}

export function ColumnsView({
  agents,
  agentFindings,
  sseStatuses,
  onViewTrace,
}: ColumnsViewProps) {
  const t = useTranslations("multiRuns");

  // Build a map of run_id → findings list for fast lookup.
  const findingsByRunId = React.useMemo(() => {
    const map: Record<string, MultiRunFindings["agents"][number]["findings"]> = {};
    for (const agent of agentFindings) {
      // Match agent findings to agent run via agent_id
      const agentRun = agents.find(
        (a) => a.agent_id === agent.agent_id && a.agent_name === agent.agent_name,
      );
      if (agentRun) map[agentRun.run_id] = agent.findings;
    }
    return map;
  }, [agentFindings, agents]);

  return (
    <div style={s.scroll}>
      {agents.map((agent, index) => {
        const liveStatus = sseStatuses[agent.run_id];
        const isRunning = agent.status === "running";
        const isFailed = agent.status === "failed";
        const findings = findingsByRunId[agent.run_id] ?? [];
        const agentLabel = agent.agent_name ?? t("results.unknownAgent");
        const accentColor = AGENT_COLORS[index % AGENT_COLORS.length];

        return (
          <div
            key={agent.run_id}
            style={{ ...s.column, borderLeft: `3px solid ${accentColor}` }}
          >
            <div style={s.colHeader}>
              <span style={s.agentName}>{agentLabel}</span>
              {isRunning ? (
                <span style={s.statusRunning} aria-label={t("results.agent.running")}>
                  <span style={s.spinner} aria-hidden="true" />
                  {liveStatus ?? t("results.agent.running")}
                </span>
              ) : isFailed ? (
                <span style={s.statusFailed}>
                  {t("results.agent.failed")}
                </span>
              ) : (
                <span style={s.statusText}>
                  {t("results.agent.done")}
                </span>
              )}
            </div>

            {!isRunning && !isFailed && (
              <>
                {agent.score != null && (
                  <div style={s.score}>{agent.score}</div>
                )}
                <div style={s.meta}>
                  {agent.finding_count ?? findings.length} finding
                  {(agent.finding_count ?? findings.length) !== 1 ? "s" : ""}
                </div>
              </>
            )}

            {findings.length > 0 && (
              <div style={s.findingList}>
                {findings.map((f) => (
                  <div key={f.id} style={s.findingItem} title={`${f.file}: ${f.title}`}>
                    {f.file}: {f.title}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              style={s.viewTraceBtn}
              onClick={() => onViewTrace(agent.run_id, agent.agent_name)}
            >
              {t("results.viewTrace")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
