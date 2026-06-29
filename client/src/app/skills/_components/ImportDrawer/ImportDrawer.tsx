"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs, FormField, TextInput, Textarea, SelectInput, Button } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useImportSkillPreview, useImportSkillSave, useSearchCommunitySkills } from "../../../../lib/hooks/skills";

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
  const [prefillName, setPrefillName] = React.useState("");
  const [prefillBody, setPrefillBody] = React.useState("");

  const handleCommunityImport = (name: string, body: string) => {
    setPrefillName(name);
    setPrefillBody(body);
    setTab("file");
  };

  if (!open) return null;

  return (
    <Drawer onClose={onClose} title={t("drawer.title")} subtitle={t("drawer.subtitle")} width={500}>
      <div style={{ padding: "0 24px 24px" }}>
        <Tabs tabs={DRAWER_TABS} value={tab} onChange={setTab} />
        <div style={{ marginTop: 20 }}>
          {tab === "file" && (
            <FileTab
              onClose={onClose}
              onImported={onImported}
              initialName={prefillName}
              initialBody={prefillBody}
            />
          )}
          {tab === "url" && <UrlTab onClose={onClose} onImported={onImported} />}
          {tab === "community" && (
            <CommunityTab onImportSkill={handleCommunityImport} />
          )}
        </div>
      </div>
    </Drawer>
  );
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve((ev.target?.result as string) ?? "");
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function resolveDroppedSkill(
  items: DataTransferItemList,
): Promise<{ name: string; body: string } | null> {
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]?.webkitGetAsEntry?.();
    if (!entry) continue;

    if (entry.isFile) {
      const file = await readEntryFile(entry as FileSystemFileEntry);
      return {
        name: file.name.replace(/\.(md|txt|markdown)$/i, ""),
        body: await readFileText(file),
      };
    }

    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const entries = await readDirEntries(dirEntry.createReader());
      // Prefer SKILL.md, then any .md file
      const candidates = (entries.filter((e) => e.isFile) as FileSystemFileEntry[]).sort(
        (a, b) =>
          (a.name.toUpperCase() === "SKILL.MD" ? -1 : 0) -
          (b.name.toUpperCase() === "SKILL.MD" ? -1 : 0),
      );
      const mdFile = candidates.find((e) => /\.(md|txt|markdown)$/i.test(e.name));
      if (mdFile) {
        const file = await readEntryFile(mdFile);
        return { name: entry.name, body: await readFileText(file) };
      }
    }
  }
  return null;
}

function FileTab({
  onClose,
  onImported,
  initialName = "",
  initialBody = "",
}: {
  onClose: () => void;
  onImported?: () => void;
  initialName?: string;
  initialBody?: string;
}) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState(initialName);
  const [body, setBody] = React.useState(initialBody);
  const [type, setType] = React.useState<SkillType>("custom");
  const [isDragging, setIsDragging] = React.useState(false);

  // Sync if parent re-fills from community tab.
  React.useEffect(() => { setName(initialName); }, [initialName]);
  React.useEffect(() => { setBody(initialBody); }, [initialBody]);
  const [description, setDescription] = React.useState("");
  const [preview, setPreview] = React.useState<{ name: string; body_preview: string; token_count: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const result = await resolveDroppedSkill(e.dataTransfer.items).catch(() => null);
    if (result) {
      setBody(result.body);
      if (!name) setName(result.name);
    }
  };

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        borderRadius: 8,
        border: isDragging ? "2px dashed var(--accent)" : "2px dashed transparent",
        background: isDragging ? "var(--accent)0d" : "transparent",
        padding: isDragging ? 12 : 0,
        transition: "border-color 0.15s, background 0.15s",
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--accent)", fontWeight: 500, padding: "8px 0" }}>
          Drop skill file or folder here
        </div>
      )}
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

const LANG_FILTERS = ["All", "TypeScript", "Python", "Go", "Rust"] as const;
const TAG_FILTERS = ["All", "security", "performance", "style", "test"] as const;

function CommunityTab({ onImportSkill }: { onImportSkill: (name: string, body: string) => void }) {
  const t = useTranslations("skills");
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [lang, setLang] = React.useState<string>("All");
  const [tag, setTag] = React.useState<string>("All");

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data: results, isLoading } = useSearchCommunitySkills(debouncedQuery || undefined, {
    lang: lang === "All" ? undefined : lang,
    tag: tag === "All" ? undefined : tag,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("community.searchPlaceholder")}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {LANG_FILTERS.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: lang === l ? "var(--accent)" : "var(--bg-surface)",
              color: lang === l ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
              fontWeight: lang === l ? 600 : 400,
            }}
          >
            {l}
          </button>
        ))}
        <div style={{ width: 1, background: "var(--border)", margin: "0 2px" }} />
        {TAG_FILTERS.map((tg) => (
          <button
            key={tg}
            onClick={() => setTag(tg)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: tag === tg ? "var(--accent)" : "var(--bg-surface)",
              color: tag === tg ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
              fontWeight: tag === tg ? 600 : 400,
            }}
          >
            {tg}
          </button>
        ))}
      </div>

      {isLoading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Searching…</p>
      )}

      {!isLoading && results?.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
          {t("community.noResults")}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflowY: "auto" }}>
        {results?.map((entry) => (
          <div
            key={entry.repo + entry.name}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "12px 14px",
              background: "var(--bg-elevated)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                ★ {entry.stars.toLocaleString()}
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>{entry.description}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontSize: 11, background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 4 }}>
                {entry.lang}
              </span>
              {entry.tags.map((tg) => (
                <span
                  key={tg}
                  style={{ fontSize: 11, background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 4 }}
                >
                  {tg}
                </span>
              ))}
            </div>
            <Button kind="primary" size="sm" onClick={() => onImportSkill(entry.name, entry.body)}>
              Import
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
