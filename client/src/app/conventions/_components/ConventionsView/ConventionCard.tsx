"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";

interface ConventionCardProps {
  candidate: ConventionCandidate;
  onAccept: (id: string, accepted: boolean) => void;
  onDelete: (id: string) => void;
  isPending?: boolean;
}

export function ConventionCard({ candidate, onAccept, onDelete, isPending }: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [isHovered, setIsHovered] = React.useState(false);

  const confidence = candidate.confidence ?? 0;
  const confidenceColor =
    confidence >= 0.8
      ? "var(--success)"
      : confidence >= 0.6
        ? "var(--warning)"
        : "var(--danger)";

  const evidenceLabel = formatEvidenceLabel(candidate.evidence_path ?? "");

  function handleCardClick() {
    if (candidate.evidence_path) {
      window.open(candidate.evidence_path, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${
          candidate.accepted
            ? "var(--success)"
            : isHovered && candidate.evidence_path
              ? "var(--border-hover, var(--accent))"
              : "var(--border)"
        }`,
        borderRadius: 10,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color 0.15s",
        cursor: candidate.evidence_path ? "pointer" : "default",
      }}
    >
      {/* Rule text */}
      <div style={{ fontSize: 14, fontStyle: "italic", color: "var(--text-primary)", lineHeight: 1.5 }}>
        {candidate.rule}
      </div>

      {/* Evidence + confidence row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {candidate.evidence_path && (
          <a
            href={candidate.evidence_path}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono, monospace)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 8px",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.Code size={11} />
            {evidenceLabel}
          </a>
        )}

        {/* Confidence bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("card.confidence")}
          </span>
          <div
            style={{
              width: 80,
              height: 5,
              borderRadius: 3,
              background: "var(--bg-surface)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(confidence * 100)}%`,
                height: "100%",
                background: confidenceColor,
                transition: "width 0.3s",
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: confidenceColor, fontWeight: 600, minWidth: 30 }}>
            {Math.round(confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Evidence snippet */}
      {candidate.evidence_snippet && (
        <pre
          style={{
            margin: 0,
            padding: "8px 12px",
            background: "var(--bg-primary)",
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {candidate.evidence_snippet}
        </pre>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(candidate.id); }}
          disabled={isPending}
          aria-label="Remove candidate"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: "4px 6px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            opacity: isPending ? 0.5 : 1,
          }}
        >
          <Icon.X size={14} />
        </button>
        <Button
          kind={candidate.accepted ? "primary" : "secondary"}
          size="sm"
          loading={isPending}
          onClick={(e) => { e.stopPropagation(); onAccept(candidate.id, !candidate.accepted); }}
        >
          {candidate.accepted ? t("card.accepted") : t("card.acceptAsSkill")}
        </Button>
      </div>
    </div>
  );
}

function formatEvidenceLabel(githubUrl: string): string {
  if (!githubUrl) return "";
  try {
    const url = new URL(githubUrl);
    const parts = url.pathname.split("/");
    const blobIdx = parts.indexOf("blob");
    if (blobIdx !== -1) {
      const filePath = parts.slice(blobIdx + 2).join("/");
      // "#L23-L25" → "23-25" (drop the leading # and L prefixes)
      const lineRef = url.hash.replace(/^#L/, "").replace(/-L/, "-");
      return `${filePath}${lineRef ? `:${lineRef}` : ""}`;
    }
  } catch {
    /* fall through */
  }
  return githubUrl;
}
