"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs, FormField, TextInput, Textarea, SelectInput, Button } from "@devdigest/ui";
import type { SkillType, CommunitySkillEntry } from "@devdigest/shared";
import {
  useImportSkillPreview,
  useImportSkillSave,
  useImportSkillFetch,
  useSearchCommunitySkills,
  useCommunitySkillFacets,
} from "../../../../lib/hooks/skills";
import { tagToType, estimateTokens } from "./helpers";

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
  initialTab = "file",
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialTab?: string;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState(initialTab);

  if (!open) return null;

  return (
    <Drawer onClose={onClose} title={t("drawer.title")} subtitle={t("drawer.subtitle")} width={500}>
      <div style={{ padding: "0 24px 24px" }}>
        <Tabs tabs={DRAWER_TABS} value={tab} onChange={setTab} />
        <div style={{ marginTop: 20 }}>
          {tab === "file" && (
            <FileTab onClose={onClose} onImported={onImported} />
          )}
          {tab === "url" && <UrlTab onClose={onClose} onImported={onImported} />}
          {tab === "community" && (
            <CommunityTab onClose={onClose} onImported={onImported} />
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ---- Shared preview panel (used by FileTab, UrlTab, and CommunityTab) ----

/**
 * Shows the sanitised preview returned by the server (/skills/import or
 * /skills/import/fetch) and lets the user edit name / description / type
 * before saving.  Accepts onBack so each tab can restore its own pre-preview UI.
 */
function ImportPreviewPanel({
  preview,
  initialName,
  source = "imported_url",
  initialDescription = "",
  initialType = "custom",
  onBack,
  onImported,
  onClose,
}: {
  preview: { name: string; body_preview: string; token_count: number };
  /** Pre-filled name (from user input or derived from URL). Defaults to preview.name. */
  initialName?: string;
  /** Which import source to tag this skill with. Defaults to "imported_url". */
  source?: "imported_url" | "community";
  /** Pre-filled description from the catalog entry. Defaults to "". */
  initialDescription?: string;
  /** Pre-selected type derived from catalog tags. Defaults to "custom". */
  initialType?: SkillType;
  onBack: () => void;
  onImported?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState(initialName ?? preview.name);
  const [description, setDescription] = React.useState(initialDescription);
  const [type, setType] = React.useState<SkillType>(initialType);
  const [error, setError] = React.useState<string | null>(null);

  const saveMut = useImportSkillSave();

  const handleSave = async () => {
    setError(null);
    try {
      await saveMut.mutateAsync({
        name: name || preview.name,
        description: description || preview.name,
        type,
        body: preview.body_preview,
        source,
      });
      onImported?.();
      onClose();
    } catch {
      setError(t("drawer.importFailed"));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
      </FormField>
      <FormField label="Description" hint="Describe what rule this skill enforces.">
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={name || preview.name}
        />
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
        <Button kind="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button kind="primary" size="sm" onClick={handleSave} loading={saveMut.isPending}>
          {saveMut.isPending ? t("file.importing") : t("file.import")}
        </Button>
      </div>
    </div>
  );
}

// ---- File tab ----

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
}: {
  onClose: () => void;
  onImported?: () => void;
}) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);

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

  if (preview) {
    return (
      <ImportPreviewPanel
        preview={preview}
        initialName={name}
        onBack={() => setPreview(null)}
        onImported={onImported}
        onClose={onClose}
      />
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

// ---- URL tab ----

function UrlTab({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const t = useTranslations("skills");
  const [url, setUrl] = React.useState("");
  const [urlPreview, setUrlPreview] = React.useState<{
    name: string;
    body_preview: string;
    token_count: number;
  } | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  const fetchMut = useImportSkillFetch();

  const handleFetch = async () => {
    setFetchError(null);
    try {
      const result = await fetchMut.mutateAsync({ url });
      setUrlPreview(result);
    } catch {
      setFetchError(t("url.fetchError"));
    }
  };

  if (urlPreview) {
    return (
      <ImportPreviewPanel
        preview={urlPreview}
        onBack={() => setUrlPreview(null)}
        onImported={onImported}
        onClose={onClose}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("url.label")} hint={t("url.hint")}>
        <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
      </FormField>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
        {t("url.allowlistHint")}
      </p>
      {fetchError && <p style={{ fontSize: 13, color: "#ef4444" }}>{fetchError}</p>}
      <Button
        kind="primary"
        size="sm"
        onClick={handleFetch}
        disabled={!url.trim()}
        loading={fetchMut.isPending}
      >
        {fetchMut.isPending ? t("url.fetching") : t("url.fetchButton")}
      </Button>
    </div>
  );
}

// ---- Community tab ----

function CommunityTab({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: () => void;
}) {
  const t = useTranslations("skills");
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [lang, setLang] = React.useState<string>("All");
  const [tag, setTag] = React.useState<string>("All");
  const [selectedEntry, setSelectedEntry] = React.useState<CommunitySkillEntry | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { langs, tags: catalogTags } = useCommunitySkillFacets();
  const langFilters = ["All", ...langs];
  const tagFilters = ["All", ...catalogTags];

  const { data: results, isLoading } = useSearchCommunitySkills(debouncedQuery || undefined, {
    lang: lang === "All" ? undefined : lang,
    tag: tag === "All" ? undefined : tag,
  });

  if (selectedEntry) {
    return (
      <ImportPreviewPanel
        preview={{
          name: selectedEntry.name,
          body_preview: selectedEntry.body,
          token_count: estimateTokens(selectedEntry.body),
        }}
        source="community"
        initialDescription={selectedEntry.description}
        initialType={tagToType(selectedEntry.tags)}
        onBack={() => setSelectedEntry(null)}
        onImported={onImported}
        onClose={onClose}
      />
    );
  }

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
        {langFilters.map((l) => (
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
        {tagFilters.map((tg) => (
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
            <Button kind="primary" size="sm" onClick={() => setSelectedEntry(entry)}>
              {t("community.import")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
