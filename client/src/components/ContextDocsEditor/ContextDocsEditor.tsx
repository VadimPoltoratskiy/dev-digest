"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Skeleton, ErrorState, Badge, Checkbox } from "@devdigest/ui";
import { useActiveRepo } from "../../lib/repo-context";
import { useContextFiles } from "../../lib/hooks/core";
import { contextRootColor } from "../../lib/context-colors";
import type { SpecFile } from "@devdigest/shared";
import { DocPreviewModal } from "../DocPreviewModal";
import { s } from "./styles";

/**
 * Attach/reorder Project Context documents onto an agent or a skill. Shared
 * between the Agent editor's Context tab and the Skill editor's Context tab —
 * both just supply `attachedPaths` (the owner's `context_docs` array) and
 * `onSetPaths` (the owner-specific PATCH mutation).
 *
 * Order matters: array order = injection order into "## Project context".
 * Reorder is up/down arrows (not drag-and-drop), matching the existing
 * Skills tab convention — no drag-and-drop library exists in this codebase.
 */
export function ContextDocsEditor({
  title,
  hint,
  attachedPaths,
  onSetPaths,
}: {
  title: string;
  hint: string;
  attachedPaths: string[];
  onSetPaths: (paths: string[]) => void;
}) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const { data: files, isLoading, isError, refetch } = useContextFiles(repoId);
  const [filter, setFilter] = React.useState("");
  const [preview, setPreview] = React.useState<SpecFile | null>(null);

  const byPath = new Map((files ?? []).map((f) => [f.path, f]));
  const attachedDocs = attachedPaths.map((p) => byPath.get(p)).filter((d): d is SpecFile => !!d);
  const unattached = (files ?? []).filter((f) => !attachedPaths.includes(f.path));
  const filteredUnattached = filter
    ? unattached.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : unattached;

  function toggle(path: string, checked: boolean) {
    if (checked) onSetPaths([...attachedPaths, path]);
    else onSetPaths(attachedPaths.filter((p) => p !== path));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...attachedPaths];
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
    onSetPaths(next);
  }

  function moveDown(idx: number) {
    if (idx === attachedPaths.length - 1) return;
    const next = [...attachedPaths];
    [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
    onSetPaths(next);
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{title}</h2>
        <p style={s.hint}>{hint}</p>
      </div>

      {!repoId && <div style={s.emptyBox}>{t("editorTab.noRepo")}</div>}

      {repoId && isLoading && <Skeleton height={200} />}
      {repoId && isError && <ErrorState body="Could not load documents." onRetry={() => refetch()} />}

      {repoId && !isLoading && !isError && (
        <>
          {attachedDocs.length === 0 && <div style={s.emptyBox}>{t("editorTab.noneAttached")}</div>}

          {attachedDocs.map((doc, idx) => (
            <div key={doc.path} style={s.docRow}>
              <span
                style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", minWidth: 18, textAlign: "center" }}
              >
                {idx + 1}
              </span>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button style={s.orderBtn} onClick={() => moveUp(idx)} disabled={idx === 0} aria-label="Move up">
                  <Icon.ArrowUp size={12} />
                </button>
                <button
                  style={s.orderBtn}
                  onClick={() => moveDown(idx)}
                  disabled={idx === attachedDocs.length - 1}
                  aria-label="Move down"
                >
                  <Icon.ArrowDown size={12} />
                </button>
              </div>
              <Checkbox checked onChange={(v) => !v && toggle(doc.path, false)} />
              <span style={s.docPath}>{doc.path}</span>
              <Badge color={contextRootColor(doc.root ?? "")}>{doc.root}</Badge>
              <Button kind="ghost" size="sm" onClick={() => setPreview(doc)}>
                {t("editorTab.preview")}
              </Button>
            </div>
          ))}

          <div style={s.addSection}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("editorTab.filterPlaceholder")}
              style={s.filterInput}
            />
            {filteredUnattached.map((doc) => (
              <div key={doc.path} style={{ ...s.docRow, marginTop: 8 }}>
                <Checkbox checked={false} onChange={(v) => v && toggle(doc.path, true)} />
                <span style={s.docPath}>{doc.path}</span>
                <Badge color={contextRootColor(doc.root ?? "")}>{doc.root}</Badge>
                <Button kind="ghost" size="sm" onClick={() => setPreview(doc)}>
                  {t("editorTab.preview")}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
