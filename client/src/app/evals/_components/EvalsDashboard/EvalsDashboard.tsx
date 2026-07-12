/* EvalsDashboard — workspace-level eval metrics page.
   Shows total case count, current batch metrics, delta vs prior batch,
   trend, recent run records, and the list of agents (each with its own
   eval summary) with a "Run all agents" bulk action. Clicking an agent
   row drills into /evals/[agentId] for that agent's full dashboard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Skeleton, ErrorState, LineChart, Sparkline, Button, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useEvalsDashboard, useEvalsDashboardAgents } from "../../../../lib/hooks";
import { postAgentEvalRuns } from "../../../../lib/api";
import { EvalMetricCards } from "../../../../components/EvalMetricCards";
import { fmtMetric } from "../../../../lib/eval-format";

// --------------------------------------------------------------------------
// Agents list section
// --------------------------------------------------------------------------

type RunProgress = "idle" | "running" | "done" | "error";

function AgentsListSection() {
  const t = useTranslations("eval");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: summaries, isLoading, isError } = useEvalsDashboardAgents();
  const [progress, setProgress] = React.useState<Record<string, RunProgress>>({});
  const [runningAll, setRunningAll] = React.useState(false);

  const handleRunAll = async () => {
    if (!summaries || summaries.length === 0) return;
    setRunningAll(true);
    setProgress(Object.fromEntries(summaries.map((s) => [s.agent_id, "running" as RunProgress])));

    await Promise.allSettled(
      summaries.map((s) =>
        postAgentEvalRuns(s.agent_id)
          .then(() => setProgress((prev) => ({ ...prev, [s.agent_id]: "done" })))
          .catch(() => setProgress((prev) => ({ ...prev, [s.agent_id]: "error" }))),
      ),
    );

    setRunningAll(false);
    qc.invalidateQueries({ queryKey: ["evals-dashboard-agents"] });
    qc.invalidateQueries({ queryKey: ["evals-dashboard"] });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t("dashboard.agentsHeading")}</span>
        <Button kind="primary" size="sm" icon="Play" disabled={runningAll} onClick={handleRunAll}>
          {runningAll ? t("dashboard.runningAll") : t("dashboard.runAllAgents")}
        </Button>
      </div>

      {isLoading && <Skeleton height={80} />}
      {isError && <ErrorState body={t("dashboard.errorAgents")} />}

      {summaries && summaries.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noAgents")}</p>
      )}

      {summaries && summaries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {summaries.map((s) => {
            const state = progress[s.agent_id];
            return (
              <div
                key={s.agent_id}
                onClick={() => router.push(`/evals/${s.agent_id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/evals/${s.agent_id}`);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-elevated)",
                  cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.agent_name}</span>
                    <Badge color="var(--text-secondary)" mono>
                      {s.provider}/{s.model}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {t("dashboard.versionLabel", { version: s.version })}
                    {" · "}
                    {s.last_ran_at
                      ? new Date(s.last_ran_at).toLocaleString()
                      : t("dashboard.neverRun")}
                    {state === "running" && ` · ${t("dashboard.agentRunning")}`}
                    {state === "error" && ` · ${t("dashboard.runFailed")}`}
                  </div>
                </div>

                {s.trend.length > 0 && <Sparkline data={s.trend} color="var(--accent, #4f46e5)" w={64} h={22} />}

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("dashboard.table.recall")}</span>
                  <Badge>{fmtMetric(s.current?.recall, t("evalsTab.na"))}</Badge>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("dashboard.table.precision")}</span>
                  <Badge>{fmtMetric(s.current?.precision, t("evalsTab.na"))}</Badge>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("dashboard.table.citation")}</span>
                  <Badge>{fmtMetric(s.current?.citation_accuracy, t("evalsTab.na"))}</Badge>
                </div>

                <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </div>
            );
          })}
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
  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 32 }}>
          <Skeleton height={300} />
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 32 }}>
          <ErrorState body={t("dashboard.loading")} />
        </div>
      </AppShell>
    );
  }

  if (!data) return null;

  const hasRuns = data.recent_runs.length > 0;

  return (
    <AppShell crumb={crumb}>
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

      <AgentsListSection />

      {!hasRuns ? (
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
          {t("dashboard.noRuns")}
        </p>
      ) : (
        <>
          {/* Current batch metrics */}
          <div>
            <EvalMetricCards current={data.current} delta={data.delta} />
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
                {t("dashboard.table.cost")}: {data.current.cost_usd != null ? `$${data.current.cost_usd.toFixed(4)}` : t("evalsTab.costEmpty")}
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
              <LineChart
                series={[
                  {
                    name: t("dashboard.legend.recall"),
                    color: "var(--accent, #4f46e5)",
                    data: data.trend.map((p) => p.recall),
                  },
                  {
                    name: t("dashboard.legend.precision"),
                    color: "var(--ok)",
                    data: data.trend.map((p) => p.precision),
                  },
                  {
                    name: t("dashboard.legend.citation"),
                    color: "#8b5cf6",
                    data: data.trend.map((p) => p.citation_accuracy),
                  },
                ]}
                xLabels={data.trend.map((p) => new Date(p.ran_at).toLocaleString())}
                dots
                w={900}
                h={220}
              />
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
                {(
                  [
                    ["recall", "var(--accent, #4f46e5)"],
                    ["precision", "var(--ok)"],
                    ["citation", "#8b5cf6"],
                  ] as const
                ).map(([key, color]) => (
                  <span key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                    <span style={{ color: "var(--text-secondary)" }}>{t(`dashboard.legend.${key}`)}</span>
                  </span>
                ))}
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
                    <Badge>{fmtMetric(run.recall, t("evalsTab.na"))}</Badge>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.precision")}
                    </span>
                    <Badge>{fmtMetric(run.precision, t("evalsTab.na"))}</Badge>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("dashboard.table.citation")}
                    </span>
                    <Badge>{fmtMetric(run.citation_accuracy, t("evalsTab.na"))}</Badge>
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
    </AppShell>
  );
}
