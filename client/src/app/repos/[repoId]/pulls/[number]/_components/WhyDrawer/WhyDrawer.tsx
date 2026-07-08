"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer } from "@devdigest/ui";
import type { WhyEvent } from "@devdigest/shared";
import { useWhyTimeline } from "../../../../../../../lib/hooks/why";
import { githubPrUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";
import type { CSSProperties } from "react";

export interface WhyDrawerProps {
  prId: string;
  /** owner/repo — needed to link out to the linked PR. */
  repoFullName?: string | null;
  file: string;
  line: number;
  onClose: () => void;
}

const RISK_BADGE_STYLE: Record<string, CSSProperties> = {
  low: s.badgeLow,
  medium: s.badgeMedium,
  high: s.badgeHigh,
};

function EventRow({ event, repoFullName }: { event: WhyEvent; repoFullName?: string | null }) {
  const t = useTranslations("brief");

  return (
    <div style={s.row}>
      <div style={s.rowHeader}>
        {event.is_blame_head && <span style={s.blameBadge}>{t("why.blame")}</span>}
        <span style={s.author}>{event.author}</span>
        <span style={s.sha}>{event.sha.slice(0, 7)}</span>
        <span style={s.date}>{new Date(event.date).toLocaleString()}</span>
      </div>
      <p style={s.summaryText}>{event.summary}</p>
      {event.pr_number != null && repoFullName && (
        <a
          href={githubPrUrl(repoFullName, event.pr_number)}
          target="_blank"
          rel="noreferrer"
          style={s.prLink}
        >
          {t("why.viewPr", { number: event.pr_number })}
        </a>
      )}
      {event.rationale && (
        <>
          <div style={s.sectionLabel}>{t("why.rationale")}</div>
          <p style={s.rationale}>{event.rationale}</p>
        </>
      )}
      {event.risks && event.risks.length > 0 && (
        <>
          <div style={s.sectionLabel}>{t("why.risks")}</div>
          {event.risks.map((risk, i) => (
            <p key={i} style={s.riskItem}>
              <span style={{ ...s.badge, ...RISK_BADGE_STYLE[risk.severity] }}>{risk.severity}</span>
              <strong>{risk.title}</strong> — {risk.explanation}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

export function WhyDrawer({ prId, repoFullName, file, line, onClose }: WhyDrawerProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = useWhyTimeline(prId, file, line);

  return (
    <Drawer title={t("why.title")} subtitle={`${file}:${line}`} onClose={onClose}>
      {isLoading && <div style={s.empty}>…</div>}
      {!isLoading && data && data.events.length === 0 && (
        <div style={s.empty}>{data.summary || t("why.noHistory")}</div>
      )}
      {!isLoading && data && data.events.length > 0 && (
        <div style={s.list}>
          {data.events.map((event) => (
            <EventRow key={event.sha} event={event} repoFullName={repoFullName} />
          ))}
        </div>
      )}
    </Drawer>
  );
}
