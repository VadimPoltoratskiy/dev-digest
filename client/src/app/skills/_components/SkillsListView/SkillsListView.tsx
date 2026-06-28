/* /skills — Skills list + preview panel. Selecting a skill opens its body in
   the right panel. "Add Skill" opens the import drawer or a create form. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Skeleton,
  Icon,
  Markdown,
  Badge,
  Toggle,
} from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useToggleSkill } from "../../../../lib/hooks/skills";
import { ImportDrawer } from "../ImportDrawer";
import { SkillCard } from "./SkillCard";
import { filterSkills } from "./helpers";
import { s } from "./styles";
import { TYPE_COLORS } from "./constants";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const toggle = useToggleSkill();

  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [importDrawerOpen, setImportDrawerOpen] = React.useState(false);

  const list = filterSkills(skills ?? [], search);
  const selected = skills?.find((s) => s.id === selectedId) ?? null;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <ImportDrawer
        open={importDrawerOpen}
        onClose={() => setImportDrawerOpen(false)}
        onImported={() => refetch()}
      />
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.fromFile"), icon: "File", onClick: () => setImportDrawerOpen(true) },
              { label: t("page.menu.fromUrl"), icon: "Link", onClick: () => setImportDrawerOpen(true) },
              { label: t("page.menu.community"), icon: "Globe", onClick: () => setImportDrawerOpen(true) },
            ]}
          />
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {/* Left: card grid */}
          <div style={{ flex: selected ? "0 0 340px" : "1" }}>
            {isLoading && (
              <div style={s.grid}>
                <Skeleton height={100} />
                <Skeleton height={100} />
                <Skeleton height={100} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setImportDrawerOpen(true)}
              />
            )}
            {list.length > 0 && (
              <div style={selected ? { display: "flex", flexDirection: "column", gap: 10 } : s.grid}>
                {list.map((sk) => (
                  <SkillCard
                    key={sk.id}
                    skill={sk}
                    active={sk.id === selectedId}
                    onClick={() => setSelectedId((prev) => (prev === sk.id ? null : sk.id))}
                    onToggle={(enabled) => toggle.mutate({ id: sk.id, enabled })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: preview panel */}
          {selected && (
            <SkillPreviewPanel
              skill={selected}
              onClose={() => setSelectedId(null)}
              onEdit={() => router.push(`/skills/${selected.id}`)}
              onToggle={(enabled) => toggle.mutate({ id: selected.id, enabled })}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SkillPreviewPanel({
  skill,
  onClose,
  onEdit,
  onToggle,
}: {
  skill: Skill;
  onClose: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const typeColor = TYPE_COLORS[skill.type] ?? "var(--text-secondary)";

  return (
    <div
      style={{
        flex: 1,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{skill.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{skill.description}</div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: typeColor,
            background: typeColor + "1a",
            padding: "2px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {skill.type}
        </span>
        <Toggle on={skill.enabled} onChange={onToggle} size={14} />
        <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit}>
          {t("preview.edit")}
        </Button>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
          aria-label="Close preview"
        >
          <Icon.X size={16} />
        </button>
      </div>

      {/* Panel metadata */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Badge color="var(--text-muted)" icon="GitBranch">
          {t("preview.version", { version: skill.version })}
        </Badge>
        {!skill.enabled && skill.source !== "manual" && (
          <Badge color="#f59e0b" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>

      {/* Panel body — markdown rendered */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
