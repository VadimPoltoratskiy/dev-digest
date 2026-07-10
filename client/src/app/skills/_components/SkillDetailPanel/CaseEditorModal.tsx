/* CaseEditorModal — create/edit a skill eval case: name, diff input with a rendered
   DiffViewer preview, and an expected-output section that either asserts a plain finding
   count or (kind + file + line range) matched the same way agent eval cases are scored. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs, Button, FormField, TextInput, Textarea, SelectInput } from "@devdigest/ui";
import { DiffViewer } from "@/components/diff-viewer";
import type { PrFile, SkillEvalCase } from "@devdigest/shared";
import {
  useCreateEvalCase,
  useUpdateEvalCase,
  type CreateEvalCaseInput,
} from "../../../../lib/hooks/skills";

type KindMode = "count" | "must_find" | "must_not_flag";

/** Splits a pasted diff (single-file plain patch or multi-file `diff --git`) into PrFile-shaped
    chunks for DiffViewer, which only reads `.path`/`.additions`/`.deletions`/`.patch`. */
function buildPreviewFiles(raw: string): PrFile[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const chunks = trimmed.split(/(?=^diff --git )/m).filter((c) => c.trim());
  const sources = chunks.length > 0 ? chunks : [trimmed];
  return sources.map((chunk, i) => {
    const pathMatch =
      chunk.match(/^\+\+\+ b\/(.+)$/m) ??
      chunk.match(/^diff --git a\/\S+ b\/(\S+)/m) ??
      chunk.match(/^--- a\/(.+)$/m);
    const path = pathMatch?.[1]?.trim() || `file-${i + 1}`;
    const hunkStart = chunk.indexOf("@@");
    const patch = hunkStart === -1 ? chunk : chunk.slice(hunkStart);
    let additions = 0;
    let deletions = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    return { path, additions, deletions, patch };
  });
}

export function CaseEditorModal({
  skillId,
  mode,
  initialCase,
  onClose,
}: {
  skillId: string;
  mode: "create" | "edit";
  initialCase?: SkillEvalCase;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const createCase = useCreateEvalCase(skillId);
  const updateCase = useUpdateEvalCase(skillId);

  const [activeTab, setActiveTab] = React.useState<"diff" | "preview">("diff");
  const [name, setName] = React.useState(initialCase?.name ?? "");
  const [diff, setDiff] = React.useState(initialCase?.input_diff ?? "");
  const [kindMode, setKindMode] = React.useState<KindMode>(
    initialCase?.expected.kind ? (initialCase.expected.kind as KindMode) : "count",
  );
  const [count, setCount] = React.useState(String(initialCase?.expected.expected_finding_count ?? 1));
  const [file, setFile] = React.useState(initialCase?.expected.file ?? "");
  const [startLine, setStartLine] = React.useState(
    initialCase?.expected.start_line != null ? String(initialCase.expected.start_line) : "",
  );
  const [endLine, setEndLine] = React.useState(
    initialCase?.expected.end_line != null ? String(initialCase.expected.end_line) : "",
  );
  const [findingTitle, setFindingTitle] = React.useState(initialCase?.expected.title ?? "");
  const [category, setCategory] = React.useState(initialCase?.expected.category ?? "");
  const [severity, setSeverity] = React.useState(initialCase?.expected.severity ?? "");

  const previewFiles = React.useMemo(() => buildPreviewFiles(diff), [diff]);
  const saving = createCase.isPending || updateCase.isPending;

  const canSave =
    name.trim().length > 0 &&
    diff.trim().length > 0 &&
    (kindMode === "count" || file.trim().length > 0);

  const submit = () => {
    if (!canSave) return;
    const payload: CreateEvalCaseInput = {
      name: name.trim(),
      input_diff: diff.trim(),
      category: category.trim() || undefined,
      severity: severity.trim() || undefined,
    };
    if (kindMode === "count") {
      payload.expected_finding_count = parseInt(count, 10) || 1;
    } else {
      payload.kind = kindMode;
      payload.file = file.trim();
      payload.start_line = parseInt(startLine, 10) || undefined;
      payload.end_line = parseInt(endLine, 10) || undefined;
      payload.title = findingTitle.trim() || undefined;
    }

    if (mode === "edit" && initialCase) {
      updateCase.mutate({ caseId: initialCase.id, patch: payload }, { onSuccess: onClose });
    } else {
      createCase.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <Modal
      width={720}
      title={mode === "edit" ? t("caseEditor.caseTitle", { name: initialCase?.name ?? "" }) : t("caseEditor.newCase")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("caseEditor.cancel")}
          </Button>
          <Button kind="primary" size="sm" onClick={submit} disabled={!canSave || saving}>
            {saving ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>

        <FormField label={t("caseEditor.inputLabel")} required>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "preview", label: t("caseEditor.preview") },
            ]}
            value={activeTab}
            onChange={(k) => setActiveTab(k as "diff" | "preview")}
            pad="0"
          />
          <div style={{ marginTop: 12 }}>
            {activeTab === "diff" ? (
              <Textarea
                value={diff}
                onChange={setDiff}
                rows={10}
                mono
                placeholder={t("caseEditor.diffPlaceholder")}
              />
            ) : previewFiles.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("caseEditor.previewNoDiff")}</p>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <DiffViewer files={previewFiles} />
              </div>
            )}
          </div>
        </FormField>

        <FormField label={t("caseEditor.expectedOutput")}>
          <div style={{ marginBottom: 12 }}>
            <SelectInput
              value={kindMode}
              onChange={(v) => setKindMode(v as KindMode)}
              options={[
                { value: "count", label: t("caseEditor.kindCount") },
                { value: "must_find", label: t("caseEditor.kindMustFind") },
                { value: "must_not_flag", label: t("caseEditor.kindMustNotFlag") },
              ]}
              mono={false}
            />
          </div>

          {kindMode === "count" ? (
            <FormField label={t("caseEditor.countLabel")}>
              <TextInput value={count} onChange={setCount} type="number" />
            </FormField>
          ) : (
            <>
              <FormField label={t("caseEditor.fileLabel")} required>
                <TextInput value={file} onChange={setFile} mono placeholder={t("caseEditor.filePlaceholder")} />
              </FormField>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FormField label={t("caseEditor.startLineLabel")}>
                  <TextInput value={startLine} onChange={setStartLine} type="number" />
                </FormField>
                <FormField label={t("caseEditor.endLineLabel")}>
                  <TextInput value={endLine} onChange={setEndLine} type="number" />
                </FormField>
              </div>
              <FormField label={t("caseEditor.findingTitleLabel")}>
                <TextInput
                  value={findingTitle}
                  onChange={setFindingTitle}
                  placeholder={t("caseEditor.findingTitlePlaceholder")}
                />
              </FormField>
            </>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FormField label={t("caseEditor.categoryLabel")}>
              <TextInput value={category} onChange={setCategory} placeholder={t("caseEditor.categoryPlaceholder")} />
            </FormField>
            <FormField label={t("caseEditor.severityLabel")}>
              <TextInput value={severity} onChange={setSeverity} placeholder={t("caseEditor.severityPlaceholder")} />
            </FormField>
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
