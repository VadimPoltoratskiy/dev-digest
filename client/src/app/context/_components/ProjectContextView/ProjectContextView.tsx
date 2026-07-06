"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Badge, CircularScore, SelectInput } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useContextFiles, useReindexContext } from "../../../../lib/hooks/core";
import { contextRootColor } from "../../../../lib/context-colors";
import { useToast } from "../../../../lib/toast";
import type { SpecFile } from "@devdigest/shared";
import { DocPreviewModal } from "../../../../components/DocPreviewModal";

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return `${Math.max(1, Math.round(bytes / 1024))}kb`;
}

export function ProjectContextView() {
  const t = useTranslations("context");
  const toast = useToast();
  const { repoId, repos, activeRepo, setRepoId } = useActiveRepo();

  const { data: files, isLoading, isError, refetch } = useContextFiles(repoId);
  const reindex = useReindexContext();
  const [preview, setPreview] = React.useState<SpecFile | null>(null);

  function handleReindex() {
    if (!repoId) return;
    reindex.mutate(repoId, {
      onSuccess: (status) => toast.success(t("reindexSuccess", { count: status.chunks_indexed ?? 0 })),
      onError: () => toast.error(t("reindexError")),
    });
  }

  const repoName = activeRepo?.full_name ?? activeRepo?.name ?? "";
  const total = files?.length ?? 0;
  const used = files?.filter((f) => (f.used_by_count ?? 0) > 0).length ?? 0;
  const coverage = total > 0 ? Math.round((used / total) * 100) : 0;

  const groups = React.useMemo(() => {
    const byRoot = new Map<string, SpecFile[]>();
    for (const f of files ?? []) {
      const root = f.root ?? "other";
      const list = byRoot.get(root) ?? [];
      list.push(f);
      byRoot.set(root, list);
    }
    return [...byRoot.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
              {t("title")}
              {repoName && <span style={{ color: "var(--accent)" }}> · {repoName}</span>}
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t("subtitle")}
            </p>
          </div>

          <div style={{ display: "flex", gap: 14, alignItems: "center", flexShrink: 0 }}>
            {total > 0 && (
              <div
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                title={t("coverageHint")}
              >
                <CircularScore score={coverage} size={44} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--text-muted)",
                  }}
                >
                  {t("coverage")}
                </span>
              </div>
            )}
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={reindex.isPending}
              disabled={!repoId}
              onClick={handleReindex}
            >
              {reindex.isPending ? t("indexing") : t("reindex")}
            </Button>
          </div>
        </div>

        {repos.length > 1 && (
          <div style={{ maxWidth: 320 }}>
            <SelectInput
              value={repoId ?? ""}
              options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
              onChange={setRepoId}
            />
          </div>
        )}

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 56, borderRadius: 10 }} />
            ))}
          </div>
        )}

        {isError && <ErrorState title={t("loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && total === 0 && (
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !isError && total > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {groups.map(([root, docs]) => (
              <div key={root} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: contextRootColor(root),
                  }}
                >
                  {root} ({docs.length})
                </div>
                {docs.map((doc) => (
                  <div
                    key={doc.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--bg-surface)",
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 13, fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>
                      {doc.path}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatSize(doc.size)}</span>
                    <Badge
                      color={(doc.used_by_count ?? 0) > 0 ? "var(--ok)" : "var(--text-muted)"}
                      icon="Users"
                    >
                      {t("usedBy", { count: doc.used_by_count ?? 0 })}
                    </Badge>
                    <Button kind="ghost" size="sm" onClick={() => setPreview(doc)}>
                      {t("preview")}
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </AppShell>
  );
}
