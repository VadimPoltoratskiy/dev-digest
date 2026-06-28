"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs, FormField, TextInput, Textarea, SelectInput, Button } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useImportSkillPreview, useImportSkillSave } from "../../../../lib/hooks/skills";

const SKILL_TYPE_OPTIONS = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

const DRAWER_TABS = [
  { key: "file", label: "From file", icon: "File" as const },
  { key: "url", label: "From URL", icon: "Link" as const },
  { key: "community", label: "Community", icon: "Globe" as const },
];

export function ImportDrawer({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState("file");

  if (!open) return null;

  return (
    <Drawer onClose={onClose} title={t("drawer.title")} subtitle={t("drawer.subtitle")} width={500}>
      <div style={{ padding: "0 24px 24px" }}>
        <Tabs tabs={DRAWER_TABS} value={tab} onChange={setTab} />
        <div style={{ marginTop: 20 }}>
          {tab === "file" && <FileTab onClose={onClose} onImported={onImported} />}
          {tab === "url" && <UrlTab onClose={onClose} onImported={onImported} />}
          {tab === "community" && <CommunityTab onClose={onClose} onImported={onImported} />}
        </div>
      </div>
    </Drawer>
  );
}

function FileTab({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [description, setDescription] = React.useState("");
  const [preview, setPreview] = React.useState<{ name: string; body_preview: string; token_count: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const previewMut = useImportSkillPreview();
  const saveMut = useImportSkillSave();

  const handlePreview = async () => {
    setError(null);
    try {
      const result = await previewMut.mutateAsync({ body, name: name || undefined });
      setPreview(result);
      if (!name) setName(result.name);
    } catch {
      setError(t("drawer.importFailed"));
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setError(null);
    try {
      await saveMut.mutateAsync({
        name: name || preview.name,
        description: description || preview.name,
        type,
        body: preview.body_preview,
        source: "imported_url",
      });
      onImported?.();
      onClose();
    } catch {
      setError(t("drawer.importFailed"));
    }
  };

  if (preview) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
          <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
        </FormField>
        <FormField label="Description" hint="Describe what rule this skill enforces.">
          <TextInput value={description} onChange={setDescription} placeholder={name || preview.name} />
        </FormField>
        <FormField label="Type">
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={SKILL_TYPE_OPTIONS}
          />
        </FormField>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          ~{preview.token_count.toLocaleString()} tokens · Saved disabled until vetted.
        </div>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 12,
            fontFamily: "monospace",
            maxHeight: 200,
            overflowY: "auto",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
          }}
        >
          {preview.body_preview.slice(0, 800)}
          {preview.body_preview.length > 800 ? "\n…" : ""}
        </div>
        {error && <p style={{ fontSize: 13, color: "#ef4444" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="ghost" size="sm" onClick={() => setPreview(null)}>
            Back
          </Button>
          <Button kind="primary" size="sm" onClick={handleSave} loading={saveMut.isPending}>
            {saveMut.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
      </FormField>
      <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
        <Textarea
          value={body}
          onChange={setBody}
          placeholder={t("file.bodyPlaceholder")}
          rows={10}
        />
      </FormField>
      {error && <p style={{ fontSize: 13, color: "#ef4444" }}>{error}</p>}
      <Button
        kind="primary"
        size="sm"
        onClick={handlePreview}
        disabled={!body.trim()}
        loading={previewMut.isPending}
      >
        {previewMut.isPending ? "Previewing…" : "Preview →"}
      </Button>
    </div>
  );
}

function UrlTab({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const t = useTranslations("skills");
  const [url, setUrl] = React.useState("");
  const saveMut = useImportSkillSave();

  const handleImport = async () => {
    try {
      await saveMut.mutateAsync({
        name: url.split("/").pop() ?? "Imported skill",
        description: "Imported from URL",
        type: "custom",
        body: `# Imported from ${url}\n\n_Fetch + preview not yet wired — paste the content in the File tab._`,
        source: "imported_url",
      });
      onImported?.();
      onClose();
    } catch {
      // noop
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("url.label")} hint={t("url.hint")}>
        <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
      </FormField>
      <Button kind="primary" size="sm" onClick={handleImport} disabled={!url.trim()} loading={saveMut.isPending}>
        {saveMut.isPending ? t("url.fetching") : t("url.import")}
      </Button>
    </div>
  );
}

function CommunityTab({ onClose: _onClose, onImported: _onImported }: { onClose: () => void; onImported?: () => void }) {
  const t = useTranslations("skills");
  return (
    <div style={{ padding: "20px 0", color: "var(--text-muted)", fontSize: 14, textAlign: "center" }}>
      <p>{t("community.searchPlaceholder")}</p>
      <p style={{ marginTop: 8, fontSize: 12 }}>Community catalog coming soon.</p>
    </div>
  );
}
