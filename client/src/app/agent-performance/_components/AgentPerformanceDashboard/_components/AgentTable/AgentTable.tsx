"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkline } from "@devdigest/ui";
import type { AgentPerformanceRow } from "@devdigest/shared";
import { formatCost, formatDuration, formatAcceptRate, formatRelativeTime, computeDelta } from "../../helpers";

type SortKey = "accept_rate" | "runs" | "avg_cost_usd" | "agent_name";
type SortDir = "asc" | "desc";

function sortRows(
  rows: AgentPerformanceRow[],
  key: SortKey,
  dir: SortDir,
): AgentPerformanceRow[] {
  return [...rows].sort((a, b) => {
    const multiplier = dir === "desc" ? -1 : 1;

    if (key === "accept_rate") {
      // null last regardless of direction
      if (a.accept_rate === null && b.accept_rate === null) {
        // tie-break: runs DESC, name ASC
        if (b.runs !== a.runs) return b.runs - a.runs;
        return a.agent_name.localeCompare(b.agent_name);
      }
      if (a.accept_rate === null) return 1;
      if (b.accept_rate === null) return -1;
      const diff = (a.accept_rate - b.accept_rate) * multiplier;
      if (diff !== 0) return diff;
      if (b.runs !== a.runs) return b.runs - a.runs;
      return a.agent_name.localeCompare(b.agent_name);
    }

    if (key === "runs") {
      const diff = (a.runs - b.runs) * multiplier;
      if (diff !== 0) return diff;
      return a.agent_name.localeCompare(b.agent_name);
    }

    if (key === "avg_cost_usd") {
      if (a.avg_cost_usd === null && b.avg_cost_usd === null) return 0;
      if (a.avg_cost_usd === null) return 1;
      if (b.avg_cost_usd === null) return -1;
      return (a.avg_cost_usd - b.avg_cost_usd) * multiplier;
    }

    if (key === "agent_name") {
      return a.agent_name.localeCompare(b.agent_name) * multiplier;
    }

    return 0;
  });
}

/** Trend arrow for accept rate delta vs previous period (AC-8). */
function TrendArrow({ current, prev }: { current: number | null; prev: number | null }) {
  const delta = computeDelta(current, prev);
  if (delta === null) return null;
  return (
    <span
      aria-label={`${delta.dir} ${delta.pct.toFixed(1)}%`}
      style={{
        marginLeft: 4,
        fontSize: 11,
        fontWeight: 600,
        color: delta.dir === "up" ? "var(--ok, #10b981)" : "var(--crit, #ef4444)",
      }}
    >
      {delta.dir === "up" ? "↑" : "↓"}
    </span>
  );
}

export function AgentTable({
  agents,
  period,
  from,
  to,
}: {
  agents: AgentPerformanceRow[];
  period?: string;
  from?: string;
  to?: string;
}) {
  const t = useTranslations("agentPerformance");
  const router = useRouter();

  const [sortKey, setSortKey] = React.useState<SortKey>("accept_rate");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sorted = sortRows(agents, sortKey, sortDir);

  const buildPeriodParams = () => {
    const sp = new URLSearchParams();
    if (period) sp.set("period", period);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    return sp.toString() ? `?${sp.toString()}` : "";
  };

  const navigateToAgent = (agentId: string) => {
    router.push(`/agents/${agentId}?tab=stats${buildPeriodParams().replace("?", "&")}`);
  };

  const headerStyle: React.CSSProperties = {
    padding: "10px 14px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    whiteSpace: "nowrap",
  };

  const cellStyle: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: 13,
    color: "var(--text-primary)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th
              style={headerStyle}
              onClick={() => toggleSort("agent_name")}
              aria-sort={sortKey === "agent_name" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
            >
              {t("table.agent")}{sortIndicator("agent_name")}
            </th>
            <th
              style={headerStyle}
              onClick={() => toggleSort("runs")}
              aria-sort={sortKey === "runs" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
            >
              {t("table.runs")}{sortIndicator("runs")}
            </th>
            <th
              style={headerStyle}
              onClick={() => toggleSort("avg_cost_usd")}
              aria-sort={sortKey === "avg_cost_usd" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
            >
              {t("table.avgCost")}{sortIndicator("avg_cost_usd")}
            </th>
            <th style={{ ...headerStyle, cursor: "default" }}>
              {t("table.avgDuration")}
            </th>
            <th
              style={headerStyle}
              onClick={() => toggleSort("accept_rate")}
              aria-sort={sortKey === "accept_rate" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
            >
              {t("table.acceptRate")}{sortIndicator("accept_rate")}
            </th>
            <th style={{ ...headerStyle, cursor: "default" }}>
              {t("table.lastRun")}
            </th>
            <th style={{ ...headerStyle, cursor: "default" }}>{t("table.expandTrend")}</th>
            <th style={{ ...headerStyle, cursor: "default" }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const rowKey = row.agent_id ?? `deleted-${row.agent_name}`;
            const isExpanded = expanded.has(rowKey);
            const isDeleted = row.agent_id === null;
            const trendValues = row.trend.map((p) => p.value);

            return (
              <React.Fragment key={rowKey}>
                <tr
                  style={{ cursor: isDeleted ? "default" : "pointer" }}
                  onClick={() => {
                    if (!isDeleted) {
                      navigateToAgent(row.agent_id!);
                    }
                  }}
                >
                  {/* Agent name */}
                  <td style={cellStyle}>
                    <span style={{ fontWeight: isDeleted ? 400 : 600, color: isDeleted ? "var(--text-muted)" : "var(--text-primary)" }}>
                      {isDeleted ? t("table.deletedAgent") : row.agent_name}
                    </span>
                  </td>
                  {/* Runs */}
                  <td style={{ ...cellStyle, fontFamily: "var(--font-mono, monospace)" }}>
                    {row.runs}
                  </td>
                  {/* Avg cost */}
                  <td style={{ ...cellStyle, fontFamily: "var(--font-mono, monospace)" }}>
                    {formatCost(row.avg_cost_usd)}
                  </td>
                  {/* Avg duration */}
                  <td style={{ ...cellStyle, fontFamily: "var(--font-mono, monospace)" }}>
                    {formatDuration(row.avg_duration_ms)}
                  </td>
                  {/* Accept rate + trend arrow */}
                  <td style={{ ...cellStyle, fontFamily: "var(--font-mono, monospace)" }}>
                    {formatAcceptRate(row.accept_rate)}
                    <TrendArrow current={row.accept_rate} prev={row.previous_accept_rate} />
                  </td>
                  {/* Last run */}
                  <td style={{ ...cellStyle, color: "var(--text-secondary)" }}>
                    {formatRelativeTime(row.last_run_at)}
                  </td>
                  {/* Expand trend toggle */}
                  <td style={cellStyle}>
                    {trendValues.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(rowKey);
                        }}
                        aria-label={t("table.expandTrend")}
                        aria-expanded={isExpanded}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          color: "var(--accent)",
                        }}
                      >
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </td>
                  {/* View button — absent for deleted agents (AC-23) */}
                  <td style={cellStyle}>
                    {!isDeleted && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToAgent(row.agent_id!);
                        }}
                        aria-label={`${t("table.view")} ${row.agent_name}`}
                        style={{
                          background: "var(--accent-subtle, rgba(99,102,241,0.1))",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px 12px",
                          borderRadius: 5,
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--accent)",
                        }}
                      >
                        {t("table.view")}
                      </button>
                    )}
                  </td>
                </tr>

                {/* Expanded trend sparkline row */}
                {isExpanded && trendValues.length > 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: "12px 14px 16px",
                        background: "var(--bg-surface)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                        {t("table.expandTrend")} (findings per run)
                      </div>
                      <Sparkline data={trendValues} w={240} h={40} color="var(--accent)" />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
