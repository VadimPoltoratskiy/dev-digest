"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
  useDeleteConvention,
  useConventionsToSkill,
} from "../../../../lib/hooks/conventions";
import { ConventionCard } from "./ConventionCard";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, repos, activeRepo, setRepoId } = useActiveRepo();

  const { data: candidates, isLoading, isError } = useConventions(repoId);
  const extract = useExtractConventions();
  const update = useUpdateConvention(repoId);
  const remove = useDeleteConvention(repoId);
  const toSkill = useConventionsToSkill();

  const qc = useQueryClient();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  const acceptedCount = candidates?.filter((c) => c.accepted).length ?? 0;
  const repoName = activeRepo?.name ?? t("page.repoFallback");

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  function handleAccept(id: string, accepted: boolean) {
    setPendingId(id);
    update.mutate(
      { convId: id, patch: { accepted } },
      { onSettled: () => setPendingId(null) },
    );
  }

  function handleDelete(id: string) {
    setPendingId(id);
    remove.mutate(id, { onSettled: () => setPendingId(null) });
  }

  function handleDeselectAll() {
    if (!candidates) return;
    const accepted = candidates.filter((c) => c.accepted);
    for (const c of accepted) {
      update.mutate({ convId: c.id, patch: { accepted: false } });
    }
  }

  function handleCreateSkill() {
    if (!repoId) return;
    toSkill.mutate(repoId, {
      onSuccess: (skill) => {
        qc.invalidateQueries({ queryKey: ["skills"] });
        showToast(`Skill "${skill.name}" created`);
      },
      onError: () => showToast("Failed to create skill"),
    });
  }

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbLab") },
        { label: t("page.crumbConventions") },
      ]}
    >
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
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
              {t("page.headingPrefix")}
              <span style={{ color: "var(--accent)" }}>{repoName}</span>
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("page.subtitle")}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={extract.isPending}
              disabled={!repoId}
              onClick={() => repoId && extract.mutate(repoId)}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          </div>
        </div>

        {/* Repo selector (shown when more than one repo) */}
        {repos.length > 1 && (
          <div style={{ maxWidth: 320 }}>
            <SelectInput
              value={repoId ?? ""}
              options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
              onChange={setRepoId}
            />
          </div>
        )}

        {/* Stats bar + bulk actions */}
        {candidates && candidates.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)", flex: 1 }}>
              {t("page.candidateCount", { count: candidates.length })}
            </span>
            <button
              onClick={handleDeselectAll}
              disabled={acceptedCount === 0}
              style={{
                background: "none",
                border: "none",
                cursor: acceptedCount > 0 ? "pointer" : "default",
                fontSize: 13,
                color: acceptedCount > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                padding: "4px 8px",
                borderRadius: 4,
              }}
            >
              <Icon.X size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
              {acceptedCount} of {candidates.length} accepted
            </button>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={acceptedCount === 0}
              loading={toSkill.isPending}
              onClick={handleCreateSkill}
            >
              Create skill
            </Button>
          </div>
        )}

        {/* Content */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 120, borderRadius: 10 }} />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState title={t("page.loadError")} />
        )}

        {extract.isError && (
          <div
            style={{
              background: "var(--danger-subtle, rgba(239,68,68,0.1))",
              border: "1px solid var(--danger, #ef4444)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--danger, #ef4444)",
            }}
          >
            {t("page.extractionFailed")}
            {extract.error != null && (
              <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                — {extract.error instanceof Error ? extract.error.message : String(extract.error)}
              </span>
            )}
          </div>
        )}

        {!isLoading && !isError && (!candidates || candidates.length === 0) && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={repoId ? t("page.empty.cta") : undefined}
            onCta={() => repoId && extract.mutate(repoId)}
            ctaLoading={extract.isPending}
          />
        )}

        {candidates && candidates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                onAccept={handleAccept}
                onDelete={handleDelete}
                isPending={pendingId === c.id}
              />
            ))}
          </div>
        )}

        {/* Toast */}
        {toastMsg && (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 14,
              color: "var(--text-primary)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              zIndex: 1000,
            }}
          >
            {toastMsg}
          </div>
        )}
      </div>
    </AppShell>
  );
}
