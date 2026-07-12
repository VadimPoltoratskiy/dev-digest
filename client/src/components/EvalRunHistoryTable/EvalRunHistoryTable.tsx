/* EvalRunHistoryTable — batch run history with checkbox-based two-run compare.
   Shared by the Agent Editor's Evals tab and the per-agent eval dashboard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Checkbox } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { fmtMetric, fmtCost } from "../../lib/eval-format";

function MetricCell({
  label,
  value,
  plain,
}: {
  label: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      {plain ? <span style={{ fontSize: 12 }}>{value}</span> : <Badge>{value}</Badge>}
    </div>
  );
}

export function EvalRunHistoryTable({
  runs,
  onCompare,
}: {
  runs: EvalRunRecord[];
  onCompare: (runA: string, runB: string) => void;
}) {
  const t = useTranslations("eval");

  // Compare selection — at most 2 ran_at ISO strings
  const [selectedRuns, setSelectedRuns] = React.useState<Set<string>>(new Set());

  // Group runs by ran_at (newest first, one representative row per batch)
  const batchHistory = React.useMemo((): EvalRunRecord[] => {
    const seen = new Set<string>();
    const unique: EvalRunRecord[] = [];
    for (const r of runs) {
      if (!seen.has(r.ran_at)) {
        seen.add(r.ran_at);
        unique.push(r);
      }
    }
    return unique.sort((a, b) => b.ran_at.localeCompare(a.ran_at));
  }, [runs]);

  const handleRunToggle = (ranAt: string) => {
    setSelectedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(ranAt)) {
        next.delete(ranAt);
      } else if (next.size < 2) {
        next.add(ranAt);
      } else {
        // Replace the older of the two selections
        const [oldest] = Array.from(next).sort();
        if (oldest) next.delete(oldest);
        next.add(ranAt);
      }
      return next;
    });
  };

  const handleCompare = () => {
    const sorted = Array.from(selectedRuns).sort();
    if (sorted.length !== 2) return;
    onCompare(sorted[0]!, sorted[1]!);
  };

  if (batchHistory.length === 0) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t("evalsTab.runHistory")}</span>
        {selectedRuns.size === 2 && (
          <Button kind="secondary" size="sm" icon="BarChart" onClick={handleCompare}>
            {t("evalsTab.compare")}
          </Button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {batchHistory.map((row) => {
          const isSelected = selectedRuns.has(row.ran_at);
          return (
            <div
              key={row.ran_at}
              tabIndex={0}
              onClick={() => handleRunToggle(row.ran_at)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  handleRunToggle(row.ran_at);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                border: `1px solid ${isSelected ? "var(--accent, #4f46e5)" : "var(--border)"}`,
                borderRadius: 7,
                background: isSelected ? "var(--accent-bg, #ede9fe)" : "var(--bg-elevated)",
                cursor: "pointer",
                userSelect: "none" as const,
              }}
            >
              <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: "flex" }}>
                <Checkbox checked={isSelected} onChange={() => handleRunToggle(row.ran_at)} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                  {new Date(row.ran_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" as const }}>
                <MetricCell label={t("dashboard.table.recall")} value={fmtMetric(row.recall, t("evalsTab.na"))} />
                <MetricCell label={t("dashboard.table.precision")} value={fmtMetric(row.precision, t("evalsTab.na"))} />
                <MetricCell label={t("dashboard.table.citation")} value={fmtMetric(row.citation_accuracy, t("evalsTab.na"))} />
                <MetricCell
                  label={t("dashboard.table.cost")}
                  value={fmtCost(row.cost_usd, t("evalsTab.costEmpty"))}
                  plain
                />
              </div>
            </div>
          );
        })}
      </div>

      {selectedRuns.size === 1 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{t("evalsTab.selectTwoRuns")}</p>
      )}
    </div>
  );
}
