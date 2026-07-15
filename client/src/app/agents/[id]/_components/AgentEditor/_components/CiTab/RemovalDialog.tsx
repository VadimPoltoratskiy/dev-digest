"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { useCiPreflight, useRemoveCiInstallation, useRemoveCiFromRepo } from "../../../../../../../lib/hooks";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RemovalDialogProps {
  agentId: string;
  installation: CiInstallation;
  onClose: () => void; // caller handles focus return
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RemovalDialog({ agentId, installation, onClose }: RemovalDialogProps) {
  const t = useTranslations("agents");

  const [prUrl, setPrUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Preflight (AC-2): only query for GHA installations
  const isGha = installation.target_type === "gha";
  const { data: preflight, isLoading: preflightLoading } = useCiPreflight(
    isGha ? installation.repo : null,
  );
  const canOpenPr = isGha && preflight?.has_write_access === true && !preflightLoading;

  // Mutations
  const removeFromRepo = useRemoveCiFromRepo(agentId);
  const stopTracking = useRemoveCiInstallation(agentId);

  // Keyboard: Escape key closes the dialog
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus trap: re-queries DOM after async content (preflight, prUrl) changes it
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input, [tabindex]:not([tabindex=\"-1\"])",
    );
    if (focusable.length === 0) return;
    focusable[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  });

  const handleOpenPr = () => {
    setError(null);
    removeFromRepo.mutate(
      { installationId: installation.id },
      {
        onSuccess: (data) => {
          setPrUrl(data.pr_url);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Failed to open removal PR");
        },
      },
    );
  };

  const handleStopTracking = () => {
    setError(null);
    stopTracking.mutate(installation.id, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Failed to remove installation");
      },
    });
  };

  return (
    <Modal
      title={t("ci.removeDialog.title", { repo: installation.repo })}
      onClose={onClose}
      width={480}
    >
      <div ref={dialogRef} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* GHA skill drift note */}
        {isGha && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            {t("ci.removeDialog.skillDriftNote")}
          </p>
        )}

        {/* Non-GHA note */}
        {!isGha && (
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
            {t("ci.removeDialog.nonGhaNote")}
          </p>
        )}

        {/* Access denied note */}
        {isGha && preflight?.has_write_access === false && (
          <p style={{ fontSize: 12, color: "var(--status-warning)", margin: 0 }}>
            {t("ci.removeDialog.noWriteAccess")}
          </p>
        )}

        {/* Inline error */}
        {error && (
          <p role="alert" style={{ fontSize: 12, color: "var(--status-error)", margin: 0 }}>
            {error}
          </p>
        )}

        {/* Success state: show PR link */}
        {prUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, margin: 0 }}>
              {t("ci.removeDialog.prSuccess")}{" "}
              <a href={prUrl} target="_blank" rel="noopener noreferrer">
                {t("ci.removeDialog.prView")}
              </a>
            </p>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
                alignSelf: "flex-start",
              }}
            >
              {t("ci.removeDialog.close")}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Open removal PR */}
            {isGha && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  disabled={!canOpenPr || removeFromRepo.isPending}
                  onClick={handleOpenPr}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: canOpenPr && !removeFromRepo.isPending ? "pointer" : "not-allowed",
                    opacity: canOpenPr && !removeFromRepo.isPending ? 1 : 0.5,
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    background: "var(--color-danger, #dc2626)",
                    color: "#fff",
                    alignSelf: "flex-start",
                  }}
                >
                  {t("ci.removeDialog.openPrBtn")}
                </button>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                  {t("ci.removeDialog.openPrDescription")}
                </p>
              </div>
            )}

            {/* Stop tracking only */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                type="button"
                disabled={stopTracking.isPending}
                onClick={handleStopTracking}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: stopTracking.isPending ? "not-allowed" : "pointer",
                  opacity: stopTracking.isPending ? 0.5 : 1,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  alignSelf: "flex-start",
                }}
              >
                {t("ci.removeDialog.stopTrackingBtn")}
              </button>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                {t("ci.removeDialog.stopTrackingDescription")}
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
