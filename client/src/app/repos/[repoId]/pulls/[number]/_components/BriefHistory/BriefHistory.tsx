"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BriefTimelineEntry } from "@devdigest/shared";
import { useBriefHistory } from "../../../../../../../lib/hooks/brief";
import { s } from "./styles";

/**
 * BriefTimeline panel — every previously generated Brief for a PR, newest
 * first, one row per distinct head SHA. Toggled open from PrBriefCard's
 * footer. Read-only: no regenerate action per entry (regeneration always
 * happens against the PR's current head via PrBriefCard's own footer button).
 */

const RISK_COLOR: Record<string, string> = {
  low: "var(--ok, #3dd68c)",
  medium: "var(--warn, #f5a623)",
  high: "var(--crit, #f87171)",
};

function Row({ entry }: { entry: BriefTimelineEntry }) {
  const t = useTranslations("brief");
  const [open, setOpen] = useState(false);

  return (
    <div style={s.row}>
      <button
        type="button"
        style={s.rowHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon.GitCommit size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.sha}>{entry.head_sha.slice(0, 7)}</span>
        <span
          style={{ ...s.timestamp, color: RISK_COLOR[entry.brief.risk_level], fontWeight: 600 }}
        >
          {entry.brief.risk_level}
        </span>
        <span style={s.why} title={entry.brief.why}>
          {entry.brief.why}
        </span>
        <span style={s.timestamp}>{new Date(entry.generated_at).toLocaleString()}</span>
      </button>
      {open && (
        <div style={s.expanded}>
          <div style={s.sectionLabel}>{t("block.brief.what")}</div>
          <p style={s.body}>{entry.brief.what}</p>
          <div style={s.sectionLabel}>{t("block.brief.why")}</div>
          <p style={s.body}>{entry.brief.why}</p>
          {entry.brief.risks.length > 0 && (
            <>
              <div style={s.sectionLabel}>{t("block.risks")}</div>
              {entry.brief.risks.map((risk, i) => (
                <p key={i} style={s.body}>
                  <strong>{risk.title}</strong> — {risk.explanation}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function BriefHistory({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const { data, isLoading } = useBriefHistory(prId);

  if (isLoading) return null;

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return <div style={s.empty}>{t("block.brief.history.empty")}</div>;
  }

  return (
    <div style={s.container}>
      {entries.map((entry) => (
        <Row key={entry.head_sha} entry={entry} />
      ))}
    </div>
  );
}
