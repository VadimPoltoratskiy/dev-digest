/* AgentEvalDashboard — per-agent Eval Dashboard drill-down (/evals/:agentId).
   Reuses the shared EvalMetricCards/EvalRunHistoryTable/EvalCompareView
   components (also used by the Agent Editor's Evals tab). Case CRUD stays
   in the Agent Editor — this page only surfaces run/compare/metrics. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState, LineChart, Button, Dropdown } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import {
  useAgent,
  useAgents,
  useEvalsDashboard,
  useRunAgentEvalBatch,
  useAgentEvalRuns,
} from "../../../../../lib/hooks";
import { EvalMetricCards } from "../../../../../components/EvalMetricCards";
import { EvalRunHistoryTable } from "../../../../../components/EvalRunHistoryTable";
import { EvalCompareView } from "../../../../../components/EvalCompareView";

type DateRange = "7" | "30" | "90" | "all";
const RANGE_DAYS: Record<Exclude<DateRange, "all">, number> = { "7": 7, "30": 30, "90": 90 };
const DATE_RANGES: readonly DateRange[] = ["7", "30", "90", "all"];

function cutoffDate(range: DateRange): Date | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - RANGE_DAYS[range]);
  return d;
}

export function AgentEvalDashboard({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();

  const { data: agent, isLoading: agentLoading, isError: agentError } = useAgent(agentId);
  const { data: agents } = useAgents();
  const { data, isLoading, isError, refetch } = useEvalsDashboard(agentId);
  const { data: runs } = useAgentEvalRuns(agentId);
  const runBatch = useRunAgentEvalBatch(agentId);

  const [range, setRange] = React.useState<DateRange>("30");
  const [compareA, setCompareA] = React.useState<string | null>(null);
  const [compareB, setCompareB] = React.useState<string | null>(null);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: agent?.name ?? "" },
  ];

  if (agentError || isError) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 32 }}>
          <ErrorState body={t("agentEval.errorDashboard")} onRetry={() => refetch()} />
        </div>
      </AppShell>
    );
  }

  if (agentLoading || isLoading || !agent || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 32 }}>
          <Skeleton height={300} />
        </div>
      </AppShell>
    );
  }

  const cutoff = cutoffDate(range);
  const filteredTrend = cutoff ? data.trend.filter((p) => new Date(p.ran_at) >= cutoff) : data.trend;
  const filteredRuns = cutoff ? (runs ?? []).filter((r) => new Date(r.ran_at) >= cutoff) : runs ?? [];

  if (compareA && compareB) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 28, maxWidth: 900 }}>
          <EvalCompareView
            agentId={agentId}
            runA={compareA}
            runB={compareB}
            onBack={() => {
              setCompareA(null);
              setCompareB(null);
            }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{agent.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {agent.provider}/{agent.model}
              </Badge>
              <Dropdown
                width={220}
                align="left"
                trigger={
                  <Button kind="ghost" size="sm" icon="ChevronDown">
                    {t("agentEval.switchAgent")}
                  </Button>
                }
                items={(agents ?? [])
                  .filter((a) => a.id !== agentId)
                  .map((a) => ({ label: a.name, onClick: () => router.push(`/evals/${a.id}`) }))}
              />
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              {t("agentEval.subtitle", { runs: (runs ?? []).length })}
            </p>
          </div>

          <Dropdown
            width={140}
            align="right"
            trigger={
              <Button kind="secondary" size="sm">
                {t(`agentEval.dateRange.${range}`)}
              </Button>
            }
            items={DATE_RANGES.map((r) => ({
              label: t(`agentEval.dateRange.${r}`),
              onClick: () => setRange(r),
            }))}
          />

          <Button kind="primary" size="sm" icon="Play" disabled={runBatch.isPending} onClick={() => runBatch.mutate()}>
            {runBatch.isPending ? t("evalsTab.running") : t("dashboard.runEval", { count: data.cases_total })}
          </Button>
        </div>

        {data.alert && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 7,
              border: "1px solid var(--warn)",
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
              fontSize: 13,
              color: "var(--text-primary)",
            }}
          >
            {data.alert}
          </div>
        )}

        <EvalMetricCards
          current={data.current}
          delta={data.delta}
          recallTrend={filteredTrend.map((p) => p.recall)}
          precisionTrend={filteredTrend.map((p) => p.precision)}
          citationTrend={filteredTrend.map((p) => p.citation_accuracy)}
        />

        {filteredTrend.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("dashboard.metricTrend")}</div>
            <LineChart
              series={[
                {
                  name: t("dashboard.legend.recall"),
                  color: "var(--accent, #4f46e5)",
                  data: filteredTrend.map((p) => p.recall),
                },
                { name: t("dashboard.legend.precision"), color: "var(--ok)", data: filteredTrend.map((p) => p.precision) },
                { name: t("dashboard.legend.citation"), color: "#8b5cf6", data: filteredTrend.map((p) => p.citation_accuracy) },
              ]}
              xLabels={filteredTrend.map((p) => new Date(p.ran_at).toLocaleString())}
              dots
              w={900}
              h={220}
            />
          </div>
        )}

        <EvalRunHistoryTable
          runs={filteredRuns}
          onCompare={(runA, runB) => {
            setCompareA(runA);
            setCompareB(runB);
          }}
        />

        <div>
          <a href={`/agents/${agentId}?tab=evals`} style={{ fontSize: 13, color: "var(--accent, #4f46e5)" }}>
            {t("agentEval.configureCases")}
          </a>
        </div>
      </div>
    </AppShell>
  );
}
