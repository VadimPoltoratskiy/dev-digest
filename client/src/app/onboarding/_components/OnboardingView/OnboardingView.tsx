"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useOnboardingTour, useGenerateOnboarding } from "../../../../lib/hooks/onboarding";
import { ApiError } from "../../../../lib/api";
import { OnboardingSectionCard } from "../OnboardingSectionCard";

function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/**
 * Main onboarding tour page component. Uses the active repo from context
 * (URL > localStorage > first repo) — no prop-drilling required.
 *
 * State machine:
 *  - no repoId        → skeleton placeholders
 *  - loading          → 5 skeleton cards
 *  - 404 error        → Generate CTA (AC-6)
 *  - other error      → retryable error state
 *  - no_llm_key error → Settings notice (AC-9)
 *  - tour data        → 5 section cards with Regenerate button
 */
export function OnboardingView() {
  const t = useTranslations("onboarding");
  const { repoId } = useActiveRepo();

  const tourQuery = useOnboardingTour(repoId);
  const generate = useGenerateOnboarding(repoId);

  const is404 =
    tourQuery.isError && isApiError(tourQuery.error) && tourQuery.error.status === 404;
  const isNoLlmKey =
    generate.isError &&
    isApiError(generate.error) &&
    (generate.error as ApiError).code === "no_llm_key";

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
        {/* ── No repo selected ── */}
        {!repoId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} style={{ height: 120, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {/* ── Loading ── */}
        {repoId && tourQuery.isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} style={{ height: 120, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {/* ── Non-404 error (retryable) ── */}
        {repoId && tourQuery.isError && !is404 && (
          <EmptyState
            icon="AlertTriangle"
            title={t("loadError.title")}
            cta={t("retryError")}
            onCta={() => tourQuery.refetch()}
          />
        )}

        {/* ── 404 — no tour yet → Generate CTA (AC-6) ── */}
        {repoId && is404 && (
          <>
            <EmptyState
              icon="FileText"
              title={t("generate.title")}
              body={t("generate.body")}
              cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
              onCta={() => !generate.isPending && generate.mutate()}
              ctaLoading={generate.isPending}
            />

            {/* no_llm_key notice (AC-9) */}
            {isNoLlmKey && (
              <div
                role="alert"
                style={{
                  background: "var(--warn-bg, rgba(234,179,8,0.1))",
                  border: "1px solid var(--warn, #eab308)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span>{t("noKeyNotice")}</span>
                <Link
                  href="/settings/api-keys"
                  style={{ color: "var(--accent-text)", textDecoration: "underline" }}
                >
                  {t("noKeySettingsLink")}
                </Link>
              </div>
            )}

            {/* Other generate error */}
            {generate.isError && !isNoLlmKey && (
              <div
                role="alert"
                style={{
                  background: "var(--danger-subtle, rgba(239,68,68,0.1))",
                  border: "1px solid var(--danger, #ef4444)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--danger, #ef4444)",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <span>
                  {generate.error instanceof Error
                    ? generate.error.message
                    : t("unknownError")}
                </span>
                <Button kind="ghost" size="sm" onClick={() => generate.mutate()}>
                  {t("retryError")}
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Tour data exists ── */}
        {repoId && tourQuery.data && (
          <>
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                {t("title")}
              </h1>

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {t("lastGenerated", {
                    date: new Date(tourQuery.data.generatedAt).toLocaleString(),
                  })}
                </span>
                <Button
                  kind="secondary"
                  icon="RefreshCw"
                  loading={generate.isPending}
                  disabled={generate.isPending}
                  onClick={() => generate.mutate()}
                >
                  {generate.isPending ? t("regenerating") : t("regenerate")}
                </Button>
              </div>
            </div>

            {/* Degraded notice banner */}
            {(tourQuery.data as { degraded?: boolean }).degraded === true && (
              <div
                role="status"
                style={{
                  background: "var(--warn-bg, rgba(234,179,8,0.1))",
                  border: "1px solid var(--warn, #eab308)",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                {t("degradedNotice")}
              </div>
            )}

            {/* no_llm_key notice when regenerating (AC-9) */}
            {isNoLlmKey && (
              <div
                role="alert"
                style={{
                  background: "var(--warn-bg, rgba(234,179,8,0.1))",
                  border: "1px solid var(--warn, #eab308)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span>{t("noKeyNotice")}</span>
                <Link
                  href="/settings/api-keys"
                  style={{ color: "var(--accent-text)", textDecoration: "underline" }}
                >
                  {t("noKeySettingsLink")}
                </Link>
              </div>
            )}

            {/* Other regenerate error */}
            {generate.isError && !isNoLlmKey && (
              <div
                role="alert"
                style={{
                  background: "var(--danger-subtle, rgba(239,68,68,0.1))",
                  border: "1px solid var(--danger, #ef4444)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--danger, #ef4444)",
                }}
              >
                {generate.error instanceof Error
                  ? generate.error.message
                  : t("unknownError")}
              </div>
            )}

            {/* Section cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {tourQuery.data.sections.map((section) => (
                <OnboardingSectionCard key={section.kind} section={section} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
