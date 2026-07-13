"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useCiRuns, useRefreshCiRuns } from "../../../../lib/hooks";

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

function CiRunRow({ run, t }: { run: CiRun; t: ReturnType<typeof useTranslations> }) {
  return (
    <tr
      style={{
        borderBottom: "1px solid var(--border)",
        fontSize: 13,
      }}
    >
      <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>
        {run.pr_number != null ? `#${run.pr_number}` : "—"}
      </td>
      <td style={{ padding: "10px 12px" }}>{run.repo ?? "—"}</td>
      <td style={{ padding: "10px 12px" }}>{run.agent ?? "—"}</td>
      <td style={{ padding: "10px 12px" }}>{run.status ?? "—"}</td>
      <td style={{ padding: "10px 12px" }}>
        {run.findings_count != null ? run.findings_count : "—"}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>
        {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—"}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>
        {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : "—"}
      </td>
      <td style={{ padding: "10px 12px" }}>
        {run.github_url ? (
          <a
            href={run.github_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            View
          </a>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>{t("table.jobNone")}</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Table header
// ---------------------------------------------------------------------------

function CiRunsTable({ runs, t }: { runs: CiRun[]; t: ReturnType<typeof useTranslations> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <thead>
          <tr
            style={{
              background: "var(--bg-surface)",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
              color: "var(--text-secondary)",
            }}
          >
            {(
              [
                "table.pr",
                "table.repo",
                "table.agent",
                "table.status",
                "table.findings",
                "table.cost",
                "table.duration",
                "table.job",
              ] as const
            ).map((key) => (
              <th key={key} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700 }}>
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <CiRunRow key={run.id} run={run} t={t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CiRunsView() {
  const t = useTranslations("ci-runs");
  const crumb = [{ label: t("title") }];

  const { data: runs, isLoading, isError } = useCiRuns();
  const refresh = useRefreshCiRuns();

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
          <ErrorState body="Could not load CI runs." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>{t("title")}</h1>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? t("refreshing") : t("refresh")}
          </Button>
        </div>

        {/* Table or empty state */}
        {runs && runs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("empty")}</p>
        ) : (
          runs && <CiRunsTable runs={runs} t={t} />
        )}
      </div>
    </AppShell>
  );
}
