"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SelectInput, Textarea } from "@devdigest/ui";
import type { MemoryRecord, MemoryScope, MemoryKind } from "@devdigest/shared";
import { usePatchMemory, useDeleteMemory } from "../../../../lib/hooks/memory";

interface MemoryDetailPaneProps {
  record: MemoryRecord;
  onClose: () => void;
}

const SCOPE_OPTIONS = [
  { value: "repo", label: "repo" },
  { value: "global", label: "global" },
  { value: "team", label: "team" },
];

const KIND_OPTIONS = [
  { value: "decision", label: "decision" },
  { value: "convention", label: "convention" },
  { value: "preference", label: "preference" },
  { value: "fact", label: "fact" },
  { value: "learning", label: "learning" },
];

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

export function MemoryDetailPane({ record, onClose }: MemoryDetailPaneProps) {
  const t = useTranslations("memory");
  const [isEditing, setIsEditing] = React.useState(false);
  const [content, setContent] = React.useState(record.content);
  const [scope, setScope] = React.useState<string>(record.scope);
  const [kind, setKind] = React.useState<string>(record.kind);
  const [confidenceStr, setConfidenceStr] = React.useState(
    String(record.confidence),
  );

  const patch = usePatchMemory();
  const del = useDeleteMemory();

  // Sync local form state when the selected record changes
  React.useEffect(() => {
    setContent(record.content);
    setScope(record.scope);
    setKind(record.kind);
    setConfidenceStr(String(record.confidence));
    setIsEditing(false);
  }, [record.id]);

  function handleSave() {
    const confidence = parseFloat(confidenceStr);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return;
    patch.mutate(
      {
        id: record.id,
        body: {
          content,
          scope: scope as MemoryScope,
          kind: kind as MemoryKind,
          confidence,
        },
      },
      { onSuccess: () => setIsEditing(false) },
    );
  }

  function handleDelete() {
    if (!window.confirm(t("detail.deleteConfirm"))) return;
    del.mutate(record.id, { onSuccess: onClose });
  }

  const confidence = record.confidence ?? 0;
  const confidenceColor =
    confidence >= 0.8
      ? "var(--success)"
      : confidence >= 0.6
        ? "var(--warning)"
        : "var(--danger)";

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "fit-content",
        position: "sticky",
        top: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {t("detail.stat.scope")}
        </span>
        <button
          onClick={onClose}
          aria-label="Close detail pane"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: "4px",
            borderRadius: 4,
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 4 }}>
            {t("detail.stat.confidence")}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: confidenceColor }}>
            {Math.round(confidence * 100)}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 4 }}>
            {t("detail.stat.scope")}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
            {t(`scope.${record.scope}`)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 4 }}>
            {t("detail.stat.updated")}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
            {formatDate(record.updated_at)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 4 }}>
            {t("detail.lastUsedLabel")}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
            {record.last_used_at ? formatDate(record.last_used_at) : t("card.neverUsed")}
          </div>
        </div>
      </div>

      {/* Content */}
      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
              {t("detail.contentLabel")}
            </label>
            <Textarea value={content} onChange={setContent} rows={6} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                {t("detail.scopeLabel")}
              </label>
              <SelectInput value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                {t("detail.kindLabel")}
              </label>
              <SelectInput value={kind} options={KIND_OPTIONS} onChange={setKind} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
              {t("detail.confidenceLabel")}
            </label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidenceStr}
              onChange={(e) => setConfidenceStr(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 7,
                border: "1px solid var(--border-strong)",
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                fontSize: 14,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button kind="secondary" size="sm" onClick={() => setIsEditing(false)}>
              {t("detail.cancel")}
            </Button>
            <Button kind="primary" size="sm" loading={patch.isPending} onClick={handleSave}>
              {t("detail.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
            {t("detail.contentLabel")}
          </div>
          <div
            aria-label="full-content"
            style={{
              fontSize: 14,
              color: "var(--text-primary)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {record.content}
          </div>
        </div>
      )}

      {/* Sources */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
          {t("detail.sourceContexts")}
        </div>
        {record.sources.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            {t("detail.noSources")}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {record.sources.map((s, i) => (
              <div key={i} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {s.pr != null && (
                  <span style={{ marginRight: 6, fontWeight: 600 }}>PR #{s.pr}</span>
                )}
                <span>{s.context}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <Button
          kind="secondary"
          size="sm"
          onClick={handleDelete}
          loading={del.isPending}
        >
          {t("detail.delete")}
        </Button>
        <Button
          kind="secondary"
          size="sm"
          icon="Edit"
          onClick={() => setIsEditing(true)}
          disabled={isEditing}
        >
          {t("detail.edit")}
        </Button>
      </div>
    </div>
  );
}
