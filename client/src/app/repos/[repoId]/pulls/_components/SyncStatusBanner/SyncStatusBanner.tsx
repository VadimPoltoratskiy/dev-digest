/* SyncStatusBanner — warns that the PR list is showing cached data because the
   GitHub sync is failing (outage / bad token). Rendered only while the active
   repo carries a pr_sync_error; dismissible per mount (reappears on reload
   while the sync is still failing). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { s } from "./styles";

/** Coarse relative-time label for the last successful sync ("2h ago"). */
export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SyncStatusBanner({ repo }: { repo: Repo | null }) {
  const t = useTranslations("prReview");
  const [dismissed, setDismissed] = React.useState(false);

  const error = repo?.pr_sync_error;
  // Re-surface the banner if a new/different failure arrives after a dismiss.
  React.useEffect(() => setDismissed(false), [error]);

  if (!error || dismissed) return null;

  const syncedAt = repo?.pr_synced_at;
  return (
    <div role="alert" style={s.banner}>
      <Icon.AlertTriangle size={14} />
      <div style={s.bannerText}>
        <span>
          {syncedAt
            ? t("list.syncBanner.failing", { ago: timeAgo(syncedAt) })
            : t("list.syncBanner.failingNever")}
        </span>
        <span style={s.bannerReason}>{t("list.syncBanner.reason", { reason: error })}</span>
      </div>
      <button
        type="button"
        aria-label={t("list.syncBanner.dismiss")}
        style={s.bannerDismiss}
        onClick={() => setDismissed(true)}
      >
        <Icon.X size={13} />
      </button>
    </div>
  );
}
