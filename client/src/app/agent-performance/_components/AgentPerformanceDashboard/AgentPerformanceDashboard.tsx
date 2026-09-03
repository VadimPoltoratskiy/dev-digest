"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, EmptyState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerformance } from "@/lib/hooks/performance";
import { SummaryCards } from "./_components/SummaryCards";
import { AgentTable } from "./_components/AgentTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import { PERIOD_PRESETS } from "./constants";

export function AgentPerformanceDashboard() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const search = useSearchParams();

  const period = search.get("period") ?? undefined;
  const from = search.get("from") ?? undefined;
  const to = search.get("to") ?? undefined;

  // Custom date range state (local inputs, not committed until Apply).
  const [customFrom, setCustomFrom] = React.useState(from ?? "");
  const [customTo, setCustomTo] = React.useState(to ?? "");

  const params = { period, from, to };
  const { data, isLoading, isError, refetch } = useAgentPerformance(params);

  // "30d" is the default when no period param is present.
  const activePeriod = period ?? "30d";

  const setPeriod = (p: string) => {
    const sp = new URLSearchParams();
    sp.set("period", p);
    router.push(`/agent-performance?${sp.toString()}`);
  };

  // Apply custom range only when from <= to (AC-5 UI guard).
  const customRangeValid =
    customFrom.length > 0 && customTo.length > 0 && customFrom <= customTo;

  const applyCustom = () => {
    if (!customRangeValid) return;
    const sp = new URLSearchParams();
    sp.set("period", "custom");
    sp.set("from", customFrom);
    sp.set("to", customTo);
    router.push(`/agent-performance?${sp.toString()}`);
  };

  const crumb = [{ label: t("title") }];

  return (
    <AppShell crumb={crumb}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {t("title")}
            </h1>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 14,
                color: "var(--text-secondary)",
              }}
            >
              {t("subtitle")}
            </p>
          </div>

          {/* Period selector ─────────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                aria-pressed={activePeriod === p.value}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background:
                    activePeriod === p.value
                      ? "var(--accent)"
                      : "var(--bg-elevated)",
                  color:
                    activePeriod === p.value ? "#fff" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {t(p.labelKey as Parameters<typeof t>[0])}
              </button>
            ))}

            {/* Custom date range (from <= to guard, AC-5) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 6px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-elevated)",
              }}
            >
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label={t("from")}
                style={{
                  fontSize: 12,
                  padding: "3px 6px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom}
                aria-label={t("to")}
                style={{
                  fontSize: 12,
                  padding: "3px 6px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              />
              <button
                onClick={applyCustom}
                disabled={!customRangeValid}
                style={{
                  padding: "3px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: customRangeValid ? "var(--accent)" : "var(--bg-surface)",
                  color: customRangeValid ? "#fff" : "var(--text-muted)",
                  cursor: customRangeValid ? "pointer" : "not-allowed",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {t("apply")}
              </button>
            </div>
          </div>
        </div>

        {/* ── Loading ─────────────────────────────────────────────────────────── */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
              }}
            >
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} style={{ height: 120, borderRadius: 9 }} />
              ))}
            </div>
            <Skeleton style={{ height: 300, borderRadius: 9 }} />
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────────────── */}
        {!isLoading && isError && (
          <ErrorState title={t("loadError")} onRetry={() => void refetch()} />
        )}

        {/* ── Empty ───────────────────────────────────────────────────────────── */}
        {!isLoading && !isError && data?.summary.total_runs === 0 && (
          <EmptyState
            icon="BarChart"
            title={t("empty.title")}
            body={t("empty.body")}
          />
        )}

        {/* ── Data ────────────────────────────────────────────────────────────── */}
        {!isLoading && !isError && data && data.summary.total_runs > 0 && (
          <>
            <SummaryCards summary={data.summary} />
            <AgentTable
              agents={data.agents}
              period={period}
              from={from}
              to={to}
            />
            <CostBreakdown
              costByAgent={data.cost_by_agent}
              costByModel={data.cost_by_model}
              totalCostUsd={data.summary.total_cost_usd}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
