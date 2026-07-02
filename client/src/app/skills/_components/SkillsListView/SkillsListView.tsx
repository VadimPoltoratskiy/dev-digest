/* /skills — Skills list + detail panel. Selecting a skill opens the tabbed
   detail panel on the right. "Add Skill" opens the import drawer. */
"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Skeleton,
  Icon,
} from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useToggleSkill } from "../../../../lib/hooks/skills";
import { ImportDrawer } from "../ImportDrawer";
import { SkillDetailPanel } from "../SkillDetailPanel";
import { SkillCard } from "./SkillCard";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const searchParams = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const toggle = useToggleSkill();

  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(
    searchParams.get("selected"),
  );
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
          <div style={{ flex: selected ? "0 0 340px" : "1", minWidth: 0, overflow: selected ? "hidden" : undefined }}>
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

          {/* Right: detail panel */}
          {selected && (
            <SkillDetailPanel
              skill={selected}
              onClose={() => setSelectedId(null)}
              onUpdated={() => refetch()}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

