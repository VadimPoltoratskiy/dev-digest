/* ConfigureRunView — two-step configure run page:
   1. PR selection (repo picker + PR picker, pre-seeded from searchParams.prId)
   2. Agent cards with per-agent time/cost estimates + "Select all" control
   Footer shows aggregate estimate (max duration, sum cost) + submit button.
   All user-visible strings via useTranslations("multiRuns") under "configure" keys. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRepos, usePulls } from "@/lib/hooks";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgentEstimates, useRunMultiReview } from "@/lib/hooks/multi-runs";
import { computeAggregateDuration, computeAggregateCost } from "./helpers";
import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  page: {
    padding: "24px 32px",
    maxWidth: 840,
    margin: "0 auto",
  } satisfies CSSProperties,

  heading: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 24,
  } satisfies CSSProperties,

  section: {
    marginBottom: 28,
  } satisfies CSSProperties,

  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: 10,
  } satisfies CSSProperties,

  select: {
    display: "block",
    width: "100%",
    padding: "8px 10px",
    fontSize: 14,
    color: "var(--text-primary)",
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    cursor: "pointer",
  } satisfies CSSProperties,

  selectSmall: {
    display: "block",
    width: "auto",
    padding: "6px 10px",
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    marginBottom: 10,
  } satisfies CSSProperties,

  warning: {
    marginTop: 8,
    padding: "6px 10px",
    fontSize: 13,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    borderRadius: 5,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,

  agentsSectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } satisfies CSSProperties,

  selectAllLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    userSelect: "none" as const,
  } satisfies CSSProperties,

  agentCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 8,
    cursor: "pointer",
  } satisfies CSSProperties,

  agentCardSelected: {
    border: "1px solid var(--accent)",
  } satisfies CSSProperties,

  agentCardBody: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 4,
  } satisfies CSSProperties,

  agentSummary: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  } satisfies CSSProperties,

  agentEstimates: {
    display: "flex",
    gap: 12,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  estimateLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    borderTop: "1px solid var(--border)",
    marginTop: 12,
    gap: 12,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  footerEstimate: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  submitBtn: {
    padding: "9px 20px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: "var(--accent)",
    color: "#fff",
  } satisfies CSSProperties,

  submitBtnDisabled: {
    padding: "9px 20px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    cursor: "not-allowed",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    opacity: 0.6,
  } satisfies CSSProperties,

  loadingText: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "8px 0",
  } satisfies CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ConfigureRunViewProps {
  initialPrId?: string;
}

export function ConfigureRunView({ initialPrId }: ConfigureRunViewProps) {
  const t = useTranslations("multiRuns");
  const router = useRouter();

  // ---- Repo selection -------------------------------------------------------
  const { repoId: activeRepoId } = useActiveRepo();
  const { data: repoList } = useRepos();
  const [selectedRepoId, setSelectedRepoId] = React.useState<string | null>(null);

  // Initialize selectedRepoId once the active repo loads (avoid resetting on every render).
  const didInitRepo = React.useRef(false);
  React.useEffect(() => {
    if (!didInitRepo.current && activeRepoId) {
      setSelectedRepoId(activeRepoId);
      didInitRepo.current = true;
    }
  }, [activeRepoId]);

  // ---- PR selection ---------------------------------------------------------
  const { data: pulls, isLoading: pullsLoading } = usePulls(selectedRepoId);
  const [selectedPrId, setSelectedPrId] = React.useState<string | null>(
    initialPrId ?? null,
  );

  // ---- Agent selection -------------------------------------------------------
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(
    new Set(),
  );

  // ---- Agent estimates -------------------------------------------------------
  const { data: estimates, isLoading: estimatesLoading } = useAgentEstimates(
    selectedPrId,
  );

  // ---- Submit ----------------------------------------------------------------
  const runMultiReview = useRunMultiReview();

  // ---- Derived data ---------------------------------------------------------
  const selectedPr =
    (pulls ?? []).find((p) => p.id != null && p.id === selectedPrId) ?? null;
  const isMergedOrClosed =
    selectedPr?.status === "closed" || selectedPr?.status === "merged";

  const allAgentIds = (estimates ?? []).map((e) => e.agent_id);
  const allSelected =
    allAgentIds.length > 0 && allAgentIds.every((id) => selectedAgentIds.has(id));
  const someSelected =
    !allSelected && allAgentIds.some((id) => selectedAgentIds.has(id));

  const selectedIdsList = [...selectedAgentIds];
  const aggregateDuration = computeAggregateDuration(estimates ?? [], selectedIdsList);
  const aggregateCost = computeAggregateCost(estimates ?? [], selectedIdsList);

  const canSubmit = selectedPrId !== null && selectedAgentIds.size > 0;

  // ---- Handlers -------------------------------------------------------------

  const handleRepoChange = (repoId: string) => {
    setSelectedRepoId(repoId);
    setSelectedPrId(null);
    setSelectedAgentIds(new Set());
  };

  const handlePrChange = (prId: string) => {
    setSelectedPrId(prId || null);
    setSelectedAgentIds(new Set());
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedAgentIds(new Set());
    } else {
      setSelectedAgentIds(new Set(allAgentIds));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedPrId) return;
    const res = await runMultiReview.mutateAsync({
      prId: selectedPrId,
      agentIds: selectedIdsList,
    });
    router.push(`/multi-runs/${res.multi_run_id}`);
  };

  // ---- Footer estimate text -------------------------------------------------

  const footerEstimateText = (): string | null => {
    if (selectedAgentIds.size === 0) return null;
    if (aggregateDuration != null && aggregateCost != null) {
      return t("configure.estimateParallel", {
        duration: (aggregateDuration / 1000).toFixed(1),
        cost: aggregateCost.toFixed(2),
      });
    }
    return t("configure.estimateVaries");
  };

  // ---- Render ---------------------------------------------------------------

  const repos = repoList ?? [];
  const prs = pulls ?? [];

  return (
    <div style={s.page}>
      <h1 style={s.heading}>{t("configure.title")}</h1>

      {/* Step 1 — PR selection */}
      <section style={s.section}>
        <div style={s.sectionTitle}>{t("configure.selectPr")}</div>

        {/* Repo picker — only shown when multiple repos exist */}
        {repos.length > 1 && (
          <select
            aria-label="Select repository"
            style={s.selectSmall}
            value={selectedRepoId ?? ""}
            onChange={(e) => handleRepoChange(e.target.value)}
          >
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>
        )}

        {/* PR picker */}
        <select
          aria-label={t("configure.selectPr")}
          style={s.select}
          value={selectedPrId ?? ""}
          disabled={!selectedRepoId || pullsLoading}
          onChange={(e) => handlePrChange(e.target.value)}
        >
          <option value="">
            {pullsLoading ? t("configure.loading") : t("configure.selectPr")}
          </option>
          {prs.map((pr) =>
            pr.id != null ? (
              <option key={pr.id} value={pr.id}>
                #{pr.number} · {pr.title}
              </option>
            ) : null,
          )}
        </select>

        {/* Merged / closed warning — muted, non-blocking */}
        {isMergedOrClosed && (
          <div style={s.warning}>
            {t("configure.mergedWarning", { status: selectedPr?.status })}
          </div>
        )}
      </section>

      {/* Step 2 — Agent cards (only when PR is selected) */}
      {selectedPrId && (
        <section style={s.section}>
          <div style={s.agentsSectionHeader}>
            <div style={s.sectionTitle}>{t("configure.selectAgents")}</div>

            {/* "Select all" control */}
            {allAgentIds.length > 0 && (
              <label style={s.selectAllLabel}>
                <input
                  type="checkbox"
                  aria-label={t("configure.selectAll")}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={handleSelectAll}
                />
                {t("configure.selectAll")}
              </label>
            )}
          </div>

          {estimatesLoading ? (
            <div style={s.loadingText}>Loading…</div>
          ) : (
            <div>
              {(estimates ?? []).map((estimate) => {
                const isChecked = selectedAgentIds.has(estimate.agent_id);
                const durationText =
                  estimate.has_historical_data &&
                  estimate.estimated_duration_ms != null
                    ? `≈ ${(estimate.estimated_duration_ms / 1000).toFixed(1)}s`
                    : t("configure.noHistory");
                const costText =
                  estimate.has_historical_data &&
                  estimate.estimated_cost_usd != null
                    ? `$${estimate.estimated_cost_usd.toFixed(2)}`
                    : t("configure.noHistory");

                return (
                  <div
                    key={estimate.agent_id}
                    style={{
                      ...s.agentCard,
                      ...(isChecked ? s.agentCardSelected : {}),
                    }}
                    onClick={() => toggleAgent(estimate.agent_id)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${estimate.agent_name}`}
                      checked={isChecked}
                      onChange={() => toggleAgent(estimate.agent_id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />

                    <div style={s.agentCardBody}>
                      <div style={s.agentName}>{estimate.agent_name}</div>

                      {/* last_finding_summary — MUST be plain text, never dangerouslySetInnerHTML */}
                      {estimate.last_finding_summary != null && (
                        <div style={s.agentSummary}>
                          {estimate.last_finding_summary}
                        </div>
                      )}

                      <div style={s.agentEstimates}>
                        <span style={s.estimateLabel}>{durationText}</span>
                        <span style={s.estimateLabel}>{costText}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Footer: aggregate estimate + submit button */}
      <div style={s.footer}>
        <div style={s.footerEstimate}>
          {footerEstimateText() ??
            (!canSubmit
              ? selectedPrId === null
                ? t("configure.disabledNoPr")
                : t("configure.disabledNoAgents")
              : "")}
        </div>

        <button
          type="button"
          disabled={!canSubmit || runMultiReview.isPending}
          aria-disabled={!canSubmit || runMultiReview.isPending}
          style={canSubmit && !runMultiReview.isPending ? s.submitBtn : s.submitBtnDisabled}
          onClick={canSubmit ? () => void handleSubmit() : undefined}
        >
          {t("configure.run", { count: selectedAgentIds.size })}
        </button>
      </div>
    </div>
  );
}
