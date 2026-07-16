/* LearnModal — pre-filled modal to capture a lesson from a finding into memory.
   Mirrors CreateEvalCaseModal structure: createPortal to document.body so the
   modal is not clipped by the opacity-dimmed FindingCard container. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Modal, FormField, Textarea, SelectInput, Button } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";

export function LearnModal({
  f,
  pending,
  onSubmit,
  onClose,
}: {
  f: FindingRecord;
  pending?: boolean;
  onSubmit: (body: { content: string; scope: string; kind: string }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("prReview");

  // AC-3: content defaults to finding title; scope=repo; kind=learning
  const [content, setContent] = React.useState(f.title);
  const [scope, setScope] = React.useState<"repo" | "global" | "team">("repo");
  const [kind, setKind] = React.useState<
    "decision" | "convention" | "preference" | "fact" | "learning"
  >("learning");

  // AC-9: save disabled while content is blank
  const canSave = content.trim().length > 0;

  // Portal to <body>: FindingCards for muted findings are rendered with
  // opacity < 1 — rendering the modal inline would make it translucent.
  // Same pattern as CreateEvalCaseModal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <Modal
      width={480}
      title={t("learnModal.title")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button kind="ghost" size="sm" onClick={onClose} disabled={pending}>
            {t("learnModal.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            disabled={!canSave || pending}
            onClick={() => onSubmit({ content: content.trim(), scope, kind })}
          >
            {pending ? t("learnModal.saving") : t("learnModal.save")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
        <FormField label={t("learnModal.contentLabel")} required>
          <Textarea value={content} onChange={setContent} rows={4} />
        </FormField>
        <FormField label={t("learnModal.scopeLabel")}>
          <SelectInput
            value={scope}
            onChange={(v) => setScope(v as "repo" | "global" | "team")}
            options={[
              { value: "repo", label: t("learnModal.scopeRepo") },
              { value: "team", label: t("learnModal.scopeTeam") },
              { value: "global", label: t("learnModal.scopeGlobal") },
            ]}
            mono={false}
          />
        </FormField>
        <FormField label={t("learnModal.kindLabel")}>
          <SelectInput
            value={kind}
            onChange={(v) =>
              setKind(v as "decision" | "convention" | "preference" | "fact" | "learning")
            }
            options={[
              { value: "decision", label: t("learnModal.kindDecision") },
              { value: "convention", label: t("learnModal.kindConvention") },
              { value: "preference", label: t("learnModal.kindPreference") },
              { value: "fact", label: t("learnModal.kindFact") },
              { value: "learning", label: t("learnModal.kindLearning") },
            ]}
            mono={false}
          />
        </FormField>
      </div>
    </Modal>,
    document.body,
  );
}
