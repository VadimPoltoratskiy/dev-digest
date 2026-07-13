"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { CiFailOn } from "@devdigest/shared";
import { useCiInstallations, useCiRuns, useUpdateAgent } from "../../../../../../../lib/hooks";
import { ExportWizard } from "../ExportWizard";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CiTabProps {
  agentId: string;
  ciFailOn: CiFailOn;
  /** Portal target in the shared AgentEditor tabs bar for the "Add to CI" / "Update CI config" header actions. */
  headerActionsEl?: HTMLDivElement | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CiTab({ agentId, ciFailOn, headerActionsEl }: CiTabProps) {
  const t = useTranslations("agents");

  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardRepo, setWizardRepo] = React.useState<string | undefined>(undefined);

  const { data: installations, isLoading: instLoading } = useCiInstallations(agentId);
  const { data: runs } = useCiRuns(agentId);
  const updateAgent = useUpdateAgent();

  const openWizard = (repo?: string) => {
    setWizardRepo(repo);
    setWizardOpen(true);
  };

  const failOnOptions: Array<{ value: CiFailOn; labelKey: string }> = [
    { value: "never", labelKey: "ci.failOnOptions.never" },
    { value: "critical", labelKey: "ci.failOnOptions.critical" },
    { value: "warning", labelKey: "ci.failOnOptions.warning" },
    { value: "any", labelKey: "ci.failOnOptions.any" },
  ];

  const handleFailOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateAgent.mutate({ id: agentId, patch: { ci_fail_on: e.target.value as CiFailOn } });
  };

  const installationCount = installations?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ---------------------------------------------------------------- */}
      {/* Header-level "Add to CI" / "Update CI config" actions, portaled   */}
      {/* into the shared AgentEditor tabs bar row.                        */}
      {/* ---------------------------------------------------------------- */}
      {headerActionsEl &&
        createPortal(
          <>
            {installationCount > 0 && (
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                onClick={() => openWizard(installations?.[0]?.repo)}
              >
                {t("ci.updateConfig")}
              </Button>
            )}
            <Button kind="primary" size="sm" icon="Plus" onClick={() => openWizard()}>
              {t("ci.addToCi")}
            </Button>
          </>,
          headerActionsEl,
        )}

      {/* ---------------------------------------------------------------- */}
      {/* Deployment summary (AC-18)                                        */}
      {/* ---------------------------------------------------------------- */}
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        {t("ci.deploymentSummary", { count: installationCount })}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Per-repository installation list (AC-19)                          */}
      {/* ---------------------------------------------------------------- */}
      <div>
        {instLoading && <Skeleton height={80} />}

        {!instLoading && installationCount === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("ci.noInstallations")}</p>
        )}

        {installations && installations.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {installations.map((inst) => {
              // Find the most recent run for this installation
              const instRuns = (runs ?? []).filter((r) => r.ci_installation_id === inst.id);
              const latestRun = instRuns.sort((a, b) =>
                (b.ran_at ?? "") > (a.ran_at ?? "") ? 1 : -1,
              )[0];

              return (
                <div
                  key={inst.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elevated)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{inst.repo}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {inst.target_type}
                      {" · "}
                      {new Date(inst.installed_at).toLocaleDateString()}
                      {" · "}
                      {latestRun ? latestRun.status ?? "unknown" : "No runs yet"}
                    </div>
                  </div>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => openWizard(inst.repo)}
                  >
                    {t("ci.updateConfig")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Dashed "add another repository" affordance, always available */}
        <button
          type="button"
          onClick={() => openWizard()}
          style={{
            display: "block",
            width: "100%",
            marginTop: installationCount > 0 ? 8 : 0,
            padding: "12px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          + {t("ci.addRepo")}
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Fail CI on selector (AC-20)                                       */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <label
          htmlFor="ci-fail-on"
          style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}
        >
          {t("ci.failOn")}
        </label>
        <select
          id="ci-fail-on"
          value={ciFailOn}
          onChange={handleFailOnChange}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        >
          {failOnOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* CI Run History (AC-21)                                            */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("ci.runHistory")}</div>
        {(!runs || runs.length === 0) ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No CI runs yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-surface)",
                  fontSize: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: "monospace", marginRight: 8 }}>
                    {run.pr_number != null ? `#${run.pr_number}` : "—"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{run.repo ?? "—"}</span>
                </div>
                <span style={{ color: "var(--text-secondary)" }}>{run.status ?? "—"}</span>
                <span style={{ fontFamily: "monospace" }}>
                  {run.findings_count != null ? run.findings_count : "—"}
                </span>
                <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>
                  {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—"}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {run.ran_at ? new Date(run.ran_at).toLocaleDateString() : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Export Wizard                                                      */}
      {/* ---------------------------------------------------------------- */}
      <ExportWizard
        agentId={agentId}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        prefilledRepo={wizardRepo}
      />
    </div>
  );
}
