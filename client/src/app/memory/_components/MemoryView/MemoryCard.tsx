"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { MemoryRecord } from "@devdigest/shared";

interface MemoryCardProps {
  record: MemoryRecord;
  selected?: boolean;
  onSelect: (id: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function MemoryCard({ record, selected, onSelect }: MemoryCardProps) {
  const t = useTranslations("memory");

  const confidence = record.confidence ?? 0;
  const confidenceColor =
    confidence >= 0.8
      ? "var(--success)"
      : confidence >= 0.6
        ? "var(--warning)"
        : "var(--danger)";

  const contentPreview =
    record.content.length > 120
      ? `${record.content.slice(0, 120)}…`
      : record.content;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(record.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(record.id)}
      style={{
        background: selected
          ? "var(--bg-elevated-active, var(--bg-elevated))"
          : "var(--bg-elevated)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      {/* Tags + confidence row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span
          aria-label="scope"
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--accent-subtle, rgba(99,102,241,0.15))",
            color: "var(--accent)",
          }}
        >
          {t(`scope.${record.scope}`)}
        </span>
        <span
          aria-label="kind"
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--bg-surface)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {t(`kind.${record.kind}`)}
        </span>
        <span
          aria-label="confidence"
          style={{
            fontSize: 12,
            color: confidenceColor,
            fontWeight: 600,
            marginLeft: "auto",
          }}
        >
          {Math.round(confidence * 100)}%
        </span>
      </div>

      {/* Content preview */}
      <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
        {contentPreview}
      </div>

      {/* Sources */}
      {record.sources.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {record.sources.map((s, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                background: "var(--bg-surface)",
                padding: "1px 6px",
                borderRadius: 4,
                border: "1px solid var(--border)",
              }}
            >
              {s.pr != null ? `PR #${s.pr}` : s.context}
            </span>
          ))}
        </div>
      )}

      {/* Dates row */}
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-muted)" }}>
        <span>
          <span style={{ fontWeight: 600 }}>{t("detail.stat.updated")}:</span>{" "}
          {formatDate(record.updated_at)}
        </span>
        <span>
          {record.last_used_at ? formatDate(record.last_used_at) : t("card.neverUsed")}
        </span>
      </div>
    </div>
  );
}
