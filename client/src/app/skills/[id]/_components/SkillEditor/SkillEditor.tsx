"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button, ErrorState, Skeleton, Badge } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { AppShell } from "../../../../../components/app-shell";
import { useSkill, useUpdateSkill, useToggleSkill } from "../../../../../lib/hooks/skills";
import { useToast } from "../../../../../lib/toast";
import { SKILL_TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

export function SkillEditor({ id }: { id: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const { data: skill, isLoading, isError } = useSkill(id);
  const update = useUpdateSkill();
  const toggle = useToggleSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (!skill) return;
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }, { label: "…" }]}>
      <div style={s.page}><Skeleton height={300} /></div>
    </AppShell>
  );

  if (isError || !skill) return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.page}>
        <ErrorState
          title={t("detail.notFound.title")}
          body={t("detail.notFound.body")}
          onRetry={() => router.push("/skills")}
        />
      </div>
    </AppShell>
  );

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      { onSuccess: () => toast.success(`Saved "${name}"`) },
    );

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbLab") },
        { label: t("page.crumbSkills"), href: "/skills" },
        { label: skill.name },
      ]}
    >
      <div style={s.page}>
        <div style={s.header}>
          <button style={s.back} onClick={() => router.push("/skills")}>
            {t("detail.back")}
          </button>
          <h2 style={s.h2}>{skill.name}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge icon="GitBranch" color="var(--text-muted)">
              {t("preview.version", { version: skill.version })}
            </Badge>
            <label style={s.enabledLabel}>
              {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
              <Toggle
                on={skill.enabled}
                onChange={(enabled) => toggle.mutate({ id: skill.id, enabled })}
                size={16}
              />
            </label>
          </div>
        </div>

        {skill.source !== "manual" && (
          <div
            style={{
              marginBottom: 16,
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

        <div style={s.form}>
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
          <FormField
            label={t("preview.bodyLabel")}
            hint={t("preview.bodyHint")}
          >
            <Textarea value={body} onChange={setBody} rows={16} mono />
          </FormField>
          <div style={s.actions}>
            <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
              {update.isPending ? "Saving…" : t("preview.save")}
            </Button>
            {update.isSuccess && (
              <span style={s.savedNote}>Saved (v{update.data?.version})</span>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
