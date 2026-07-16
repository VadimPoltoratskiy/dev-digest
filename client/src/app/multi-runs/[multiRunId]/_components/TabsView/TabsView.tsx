/* TabsView — tab bar with per-agent FindingCard lists. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentRunSummary, LearnFromFindingBody, MultiRunFindings } from "@devdigest/shared";
import { FindingCard } from "@/components/FindingCard";
import { useFindingAction, useLearnFromFinding } from "@/lib/hooks/reviews";
import { useTurnFindingIntoEvalCase } from "@/lib/hooks/agents-eval";
import { useActiveRepo } from "@/lib/repo-context";
import { usePullDetail } from "@/lib/hooks/core";
import { s } from "./styles";

export interface TabsViewProps {
  agents: AgentRunSummary[];
  agentFindings: MultiRunFindings["agents"];
  sseStatuses: Record<string, string>;
  onViewTrace: (runId: string, agentName: string | null) => void;
  prId: string;
  multiRunId: string;
}

export function TabsView({
  agents,
  agentFindings,
  sseStatuses,
  onViewTrace,
  prId,
  multiRunId,
}: TabsViewProps) {
  const t = useTranslations("multiRuns");
  const [activeIndex, setActiveIndex] = React.useState(0);

  // All hooks must be called unconditionally before any early return.
  const qc = useQueryClient();
  const action = useFindingAction();
  const createEvalCase = useTurnFindingIntoEvalCase();
  const learnFromFinding = useLearnFromFinding();
  const { activeRepo } = useActiveRepo();
  const { data: pr } = usePullDetail(prId);

  if (agents.length === 0) return null;

  const activeAgent = agents[activeIndex];
  const agentLabel = activeAgent?.agent_name ?? t("results.unknownAgent");

  // Build a map of agent_id+agent_name → findings.
  const findingsForActive = React.useMemo(() => {
    if (!activeAgent) return [];
    return (
      agentFindings.find(
        (af) =>
          af.agent_id === activeAgent.agent_id &&
          af.agent_name === activeAgent.agent_name,
      )?.findings ?? []
    );
  }, [agentFindings, activeAgent]);

  const isRunning = activeAgent?.status === "running";
  const isFailed = activeAgent?.status === "failed";

  const durationS =
    activeAgent?.duration_ms != null
      ? (activeAgent.duration_ms / 1000).toFixed(1)
      : null;
  const cost =
    activeAgent?.cost_usd != null
      ? activeAgent.cost_usd.toFixed(4)
      : null;

  return (
    <div>
      {/* Tab bar */}
      <div style={s.tabBar} role="tablist">
        {agents.map((agent, idx) => {
          const label = agent.agent_name ?? t("results.unknownAgent");
          const live = sseStatuses[agent.run_id];
          const running = agent.status === "running";
          return (
            <button
              key={agent.run_id}
              type="button"
              role="tab"
              aria-selected={idx === activeIndex}
              style={idx === activeIndex ? s.tabActive : s.tab}
              onClick={() => setActiveIndex(idx)}
            >
              {label}
              {running && (
                <span
                  aria-label={t("results.agent.running")}
                  style={{ marginLeft: 6, fontSize: 11, color: "var(--accent-text)" }}
                >
                  {live ?? t("results.agent.running")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {activeAgent && (
        <div style={s.tabContent} role="tabpanel">
          {/* Summary card */}
          <div style={s.summaryCard}>
            <div style={s.summaryRow}>
              {activeAgent.score != null && (
                <div style={s.score}>{activeAgent.score}</div>
              )}
              {isRunning ? (
                <div style={s.statusRunning} aria-label={t("results.agent.running")}>
                  <span style={s.spinner} aria-hidden="true" />
                  {t("results.agent.running")}
                </div>
              ) : isFailed ? (
                <div style={{ ...s.meta, color: "var(--error)" }}>
                  {t("results.agent.failed")}
                  {activeAgent.error ? `: ${activeAgent.error}` : ""}
                </div>
              ) : (
                <div style={s.meta}>
                  {t("results.agent.done")}
                  {durationS != null ? ` · ${durationS}s` : ""}
                  {cost != null ? ` · $${cost}` : ""}
                </div>
              )}

              <button
                type="button"
                style={s.viewTraceBtn}
                onClick={() =>
                  onViewTrace(activeAgent.run_id, activeAgent.agent_name)
                }
              >
                {t("results.viewTrace")}
              </button>
            </div>
          </div>

          {/* FindingCard list */}
          {findingsForActive.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              defaultExpanded={false}
              pending={action.isPending}
              evalCasePending={createEvalCase.isPending}
              learnPending={learnFromFinding.isPending}
              repoFullName={activeRepo?.full_name}
              headSha={pr?.head_sha}
              onAction={(act, reply) =>
                action.mutate(
                  { findingId: f.id, action: act, reply, prId },
                  {
                    onSuccess: () =>
                      qc.invalidateQueries({ queryKey: ["multi-run-findings", multiRunId] }),
                  },
                )
              }
              onCreateEvalCase={(kind, name) =>
                createEvalCase.mutate({ findingId: f.id, kind, name })
              }
              onLearn={(body) =>
                learnFromFinding.mutate({ findingId: f.id, body: body as LearnFromFindingBody })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
