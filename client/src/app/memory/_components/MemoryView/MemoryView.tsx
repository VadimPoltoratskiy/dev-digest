"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton, SelectInput, TextInput } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useMemory } from "../../../../lib/hooks/memory";
import { MemoryCard } from "./MemoryCard";
import { MemoryDetailPane } from "./MemoryDetailPane";

export function MemoryView() {
  const t = useTranslations("memory");

  const SCOPE_OPTIONS = [
    { value: "", label: t("page.filters.scopeAll") },
    { value: "repo", label: t("scope.repo") },
    { value: "global", label: t("scope.global") },
    { value: "team", label: t("scope.team") },
  ];

  const KIND_OPTIONS = [
    { value: "", label: t("page.filters.kindAll") },
    { value: "decision", label: t("kind.decision") },
    { value: "convention", label: t("kind.convention") },
    { value: "preference", label: t("kind.preference") },
    { value: "fact", label: t("kind.fact") },
    { value: "learning", label: t("kind.learning") },
  ];
  const { repoId } = useActiveRepo();

  const [scope, setScope] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [showStale, setShowStale] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const filters = {
    ...(scope ? { scope } : {}),
    ...(kind ? { kind } : {}),
    ...(repoId ? { repo: repoId } : {}),
    ...(showStale ? { freshness: "stale" as const } : {}),
    ...(q ? { q } : {}),
  };

  const { data, isLoading, isError } = useMemory(filters);

  const records = data?.records ?? [];
  const searchMode = data?.search_mode;
  const selectedRecord = records.find((r) => r.id === selectedId) ?? null;

  // Clear selection when it's no longer in the list
  React.useEffect(() => {
    if (selectedId && !records.find((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [records, selectedId]);

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Header */}
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
          {t("page.heading")}
        </h1>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ minWidth: 140 }}>
            <SelectInput
              value={scope}
              options={SCOPE_OPTIONS}
              onChange={setScope}
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <SelectInput
              value={kind}
              options={KIND_OPTIONS}
              onChange={setKind}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={showStale}
              onChange={(e) => setShowStale(e.target.checked)}
            />
            {t("page.filters.showStale")}
          </label>
        </div>

        {/* Search box + search_mode badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, maxWidth: 480 }}>
            <TextInput
              value={q}
              onChange={setQ}
              placeholder={t("page.searchPlaceholder")}
            />
          </div>
          {searchMode && (
            <span
              aria-label="search-mode-badge"
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "3px 10px",
                borderRadius: 12,
                background:
                  searchMode === "semantic"
                    ? "var(--accent-subtle, rgba(99,102,241,0.15))"
                    : "var(--bg-surface)",
                color:
                  searchMode === "semantic"
                    ? "var(--accent)"
                    : "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              {searchMode === "semantic"
                ? t("searchMode.semantic")
                : t("searchMode.text")}
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 120, borderRadius: 10 }} />
            ))}
          </div>
        )}

        {isError && <ErrorState title={t("page.loadError")} />}

        {!isLoading && !isError && records.length === 0 && (
          <EmptyState
            icon="Brain"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
          />
        )}

        {!isLoading && !isError && records.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: selectedRecord ? "1fr 380px" : "1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            {/* Record list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {records.map((record) => (
                <MemoryCard
                  key={record.id}
                  record={record}
                  selected={record.id === selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>

            {/* Detail pane */}
            {selectedRecord && (
              <MemoryDetailPane
                record={selectedRecord}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
