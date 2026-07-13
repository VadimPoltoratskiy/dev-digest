/* RunReviewDropdown — PR-page trigger for single-agent and multi-agent reviews.
   - Single-agent: "Run all enabled agents" / per-agent items call POST /pulls/:id/review.
   - Multi-agent: checkbox picker with per-agent estimates; calls POST /pulls/:id/multi-review.
   The dropdown manages its own `open` state so estimates can be lazy-fetched on open
   (INSIGHTS: lazy-fetch-on-open pattern). */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import { useAgentEstimates, useRunMultiReview } from "../../../../../../../lib/hooks/multi-runs";
import { DROPDOWN_WIDTH, ESTIMATE_COLUMN_WIDTH } from "./constants";
import type { AgentEstimate } from "@devdigest/shared";

// ---- Helpers ----------------------------------------------------------------

function formatDuration(ms: number): number {
  return Math.round(ms / 1000);
}

function formatCost(usd: number): string {
  return usd.toFixed(2);
}

// ---- Sub-components ---------------------------------------------------------

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />;
}

function MenuItem({
  label,
  icon,
  muted,
  onClick,
}: {
  label: string;
  icon?: keyof typeof Icon;
  muted?: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const I = icon ? Icon[icon] : null;
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "none",
        background: hover ? "var(--bg-hover)" : "transparent",
        color: muted ? "var(--text-secondary)" : "var(--text-primary)",
        fontSize: 14,
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {I && <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

// ---- Main component ---------------------------------------------------------

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useRunReview();
  const runMultiReview = useRunMultiReview();

  const [open, setOpen] = React.useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(new Set());
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Lazy-fetch estimates only when dropdown is open (INSIGHTS: lazy-fetch-on-open pattern).
  const { data: estimates, isLoading: estimatesLoading } = useAgentEstimates(
    open ? prId : null,
  );

  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);
  const isPending = run.isPending || runMultiReview.isPending;

  // Close dropdown + reset selection on click-outside.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelectedAgentIds(new Set());
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const closeDropdown = () => {
    setOpen(false);
    setSelectedAgentIds(new Set());
  };

  // ---- Single-agent kick ----
  const kick = async (opts: { all?: boolean; agentId?: string }) => {
    onRunStart?.();
    closeDropdown();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  // ---- Multi-agent kick ----
  const kickMulti = async () => {
    const agentIds = [...selectedAgentIds];
    onRunStart?.();
    closeDropdown();
    try {
      const res = await runMultiReview.mutateAsync({ prId, agentIds });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      router.push(`/multi-runs/${res.multi_run_id}`);
    } finally {
      onRunSettled?.();
    }
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

  const getEstimateLabel = (estimate: AgentEstimate): string => {
    if (!estimate.has_historical_data) {
      return t("runReview.noHistoryYet");
    }
    const durationMs = estimate.estimated_duration_ms;
    const costUsd = estimate.estimated_cost_usd;
    if (durationMs != null && costUsd != null) {
      return t("runReview.estimateLabel", {
        duration: formatDuration(durationMs),
        cost: formatCost(costUsd),
      });
    }
    return t("runReview.noHistoryYet");
  };

  const canRunMulti = selectedAgentIds.size > 0;

  // Per-agent single-run items (unchanged from original).
  const agentMenuItems =
    all.length > 0
      ? all.map((a) => ({
          label: a.name,
          hint: a.enabled ? a.model : `${a.model} · disabled`,
          agentId: a.id,
        }))
      : null;

  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger */}
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: DROPDOWN_WIDTH,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 6,
            zIndex: 40,
          }}
        >
          {/* Merged/closed PR warning */}
          {warnMerged && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  color: "var(--text-secondary)",
                  fontSize: 13,
                }}
              >
                <Icon.AlertTriangle size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                {t("runReview.mergedWarning")}
              </div>
              <Divider />
            </>
          )}

          {/* Multi-select section: one checkbox row per agent (from estimates). */}
          {estimatesLoading ? (
            <div
              style={{
                padding: "8px 10px",
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              {t("runReview.estimatesLoading")}
            </div>
          ) : (
            (estimates ?? []).map((estimate) => (
              <div
                key={estimate.agent_id}
                style={{ padding: "4px 6px" }}
              >
                <Checkbox
                  checked={selectedAgentIds.has(estimate.agent_id)}
                  onChange={() => toggleAgent(estimate.agent_id)}
                  label={
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flex: 1,
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                        {estimate.agent_name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          flexShrink: 0,
                          width: ESTIMATE_COLUMN_WIDTH,
                          textAlign: "right",
                        }}
                      >
                        {getEstimateLabel(estimate)}
                      </span>
                    </span>
                  }
                />
              </div>
            ))
          )}

          {/* Divider between multi-select and primary action. */}
          <Divider />

          {/* Primary multi-agent action button. */}
          <div style={{ padding: "2px 4px" }}>
            <button
              type="button"
              aria-disabled={!canRunMulti}
              disabled={!canRunMulti}
              onClick={canRunMulti ? kickMulti : undefined}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid " + (canRunMulti ? "var(--accent)" : "var(--border-strong)"),
                background: canRunMulti ? "var(--accent)" : "var(--bg-elevated)",
                color: canRunMulti ? "#fff" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: canRunMulti ? "pointer" : "not-allowed",
                opacity: canRunMulti ? 1 : 0.6,
                textAlign: "center",
              }}
            >
              {t("runReview.runMultiAgentReview", { count: selectedAgentIds.size })}
            </button>
          </div>

          <Divider />

          {/* Run all enabled agents (single-agent path, unchanged). */}
          <MenuItem
            label={t("runReview.runAll")}
            icon="Play"
            muted={!hasEnabled}
            onClick={() => kick({ all: true })}
          />

          <Divider />

          {/* Per-agent single-run items (unchanged). */}
          {agentMenuItems
            ? agentMenuItems.map((a) => (
                <MenuItem
                  key={a.agentId}
                  label={a.label}
                  icon="Cpu"
                  onClick={() => kick({ agentId: a.agentId })}
                />
              ))
            : (
              <MenuItem
                label="No agents yet — create one"
                icon="Plus"
                muted
                onClick={() => router.push("/agents")}
              />
            )}

          <Divider />

          {/* Configure agents link — changed to /multi-runs/configure?prId=... */}
          <Link
            href={`/multi-runs/configure?prId=${prId}`}
            onClick={closeDropdown}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              color: "var(--text-secondary)",
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <Icon.Settings size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            {t("runReview.configureAgents")}
          </Link>
        </div>
      )}
    </div>
  );
}
