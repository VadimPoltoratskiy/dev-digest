"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button, Badge } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill, useToggleSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";

const SKILL_TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

export function ConfigTab({
  skill,
  onUpdated,
}: {
  skill: Skill;
  onUpdated?: (updated: Skill) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const toggle = useToggleSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  // Sync when the selected skill changes.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (updated) => {
          toast.success(`Saved "${name}" (v${updated.version})`);
          onUpdated?.(updated);
        },
      },
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 20px 24px" }}>
      {skill.source !== "manual" && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "#f59e0b1a",
            border: "1px solid #f59e0b33",
            fontSize: 13,
            color: "#b45309",
          }}
        >
          {t("preview.untrustedNotice")}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Badge icon="GitBranch" color="var(--text-muted)">
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => toggle.mutate({ id: skill.id, enabled })}
            size={14}
          />
        </label>
      </div>

      <FormField label="Name" required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label="Description" hint="Describe what rule this skill enforces — this becomes the skill's interface contract.">
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label="Type">
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_OPTIONS}
        />
      </FormField>
      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
        <Textarea value={body} onChange={setBody} rows={14} mono />
      </FormField>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : t("preview.save")}
        </Button>
        {update.isSuccess && (
          <span style={{ fontSize: 13, color: "var(--ok)" }}>
            Saved (v{update.data?.version})
          </span>
        )}
      </div>
    </div>
  );
}
