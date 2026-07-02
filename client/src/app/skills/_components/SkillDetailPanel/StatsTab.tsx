"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { MetricCard, Donut } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../lib/hooks/skills";

const CATEGORY_COLORS: Record<string, string> = {
  security: "#ef4444",
  bug: "#f59e0b",
  perf: "#3b82f6",
  style: "#8b5cf6",
  test: "#10b981",
};

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat.toLowerCase()] ?? "#6b7280";
}

export function StatsTab({ skill }: { skill: Skill }) {
  const router = useRouter();
  const { data: stats, isLoading, isError } = useSkillStats(skill.id);

  if (isLoading) return <div style={{ padding: 20 }}><Skeleton height={260} /></div>;
  if (isError || !stats) return <div style={{ padding: 20 }}><ErrorState body="Failed to load stats." /></div>;

  const donutSegments = stats.findings_by_category.map((c) => ({
    label: c.category,
    value: c.count,
    color: categoryColor(c.category),
  }));

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MetricCard label="USED BY" value={stats.agents_count} suffix=" agents" />
        <MetricCard label="PULL FREQUENCY" value={stats.pull_frequency.toFixed(0)} suffix="%" />
        <MetricCard label="ACCEPT RATE" value={stats.accept_rate.toFixed(0)} suffix="%" />
        <MetricCard label="FINDINGS (30D)" value={stats.findings_30d} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Agents using this skill */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            Agents using this skill
          </div>
          {stats.agents.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No agents linked.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.agents.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--bg-elevated)",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{a.name}</span>
                  <button
                    onClick={() => router.push(`/agents/${a.id}`)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--accent)",
                      padding: 0,
                    }}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Findings by category donut */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            Findings by category
          </div>
          {donutSegments.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No findings recorded yet.</p>
          ) : (
            <Donut segments={donutSegments} valuePrefix="" />
          )}
        </div>
      </div>
    </div>
  );
}
