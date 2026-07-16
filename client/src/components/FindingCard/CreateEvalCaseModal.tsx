/* CreateEvalCaseModal — pick a name + expected outcome (must_find /
   must_not_flag) before turning a finding into an agent eval case. The diff
   itself is derived server-side from the PR file patch, so this only collects
   what the caller must supply. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, SelectInput, Button } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineLabel } from "./helpers";

type EvalCaseKind = "must_find" | "must_not_flag";

export function CreateEvalCaseModal({
  f,
  pending,
  onSubmit,
  onClose,
}: {
  f: FindingRecord;
  pending?: boolean;
  onSubmit: (kind: EvalCaseKind, name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const [name, setName] = React.useState(f.title.slice(0, 80));
  // Smart default: a dismissed finding is a known false positive ("must not
  // flag"); an accepted (or not-yet-actioned) finding defaults to the more
  // common case, "must find" — either way the user can override it.
  const [kind, setKind] = React.useState<EvalCaseKind>(
    f.dismissed_at && !f.accepted_at ? "must_not_flag" : "must_find",
  );

  const canSave = name.trim().length > 0;

  // Portal to <body>: this modal is only shown on accepted/dismissed findings,
  // whose FindingCard is dimmed with opacity < 1 — rendering inline would make
  // the modal translucent. Same pattern as FindingsCounter.
  if (typeof document === "undefined") return null;

  return createPortal(
    <Modal
      width={480}
      title={t("findingEvalModal.title")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button kind="ghost" size="sm" onClick={onClose} disabled={pending}>
            {t("findingEvalModal.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            disabled={!canSave || pending}
            onClick={() => onSubmit(kind, name.trim())}
          >
            {pending ? t("findingEvalModal.saving") : t("findingEvalModal.save")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
        <FormField label={t("findingEvalModal.nameLabel")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>
        <FormField label={t("findingEvalModal.kindLabel")}>
          <SelectInput
            value={kind}
            onChange={(v) => setKind(v as EvalCaseKind)}
            options={[
              { value: "must_find", label: t("findingEvalModal.kindMustFind") },
              { value: "must_not_flag", label: t("findingEvalModal.kindMustNotFlag") },
            ]}
            mono={false}
          />
        </FormField>
        <FormField label={t("findingEvalModal.locationLabel")}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }} className="mono">
            {f.file}:{lineLabel(f)}
          </div>
        </FormField>
      </div>
    </Modal>,
    document.body,
  );
}
