"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, MonoLink } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief } from "../../../../../../../lib/hooks/brief";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";
import type { CSSProperties } from "react";

interface PrBriefCardProps {
  prId: string;
  /** owner/repo — needed to build GitHub blob deep-links for file_refs. */
  repoFullName?: string | null;
  /** PR head SHA — pins file deep-links so line numbers stay accurate. */
  headSha?: string | null;
}

const RISK_BADGE_STYLE: Record<string, CSSProperties> = {
  low: s.badgeLow,
  medium: s.badgeMedium,
  high: s.badgeHigh,
};

export function PrBriefCard({ prId, repoFullName, headSha }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  const canLink = !!repoFullName && !!headSha;

  if (isLoading) return null;

  if (data === null || data === undefined) {
    return (
      <section>
        <SectionLabel icon="FileText">{t("block.brief.label")}</SectionLabel>
        <div style={s.card}>
          <button
            style={s.generateBtn}
            onClick={() => generate.mutate({})}
            disabled={generate.isPending}
          >
            {generate.isPending ? t("block.brief.generating") : t("block.brief.generate")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel icon="FileText">{t("block.brief.label")}</SectionLabel>
      <div style={s.card}>
        {/* What */}
        <div style={s.sectionLabel}>{t("block.brief.what")}</div>
        <p style={s.body}>{data.what}</p>

        {/* Why */}
        <div style={s.sectionLabel}>{t("block.brief.why")}</div>
        <p style={s.body}>{data.why}</p>

        {/* Risk level */}
        <div style={s.riskLevelRow}>
          <span style={s.sectionLabel}>{t("block.brief.riskLevel")}:</span>
          <span style={{ ...s.badge, ...RISK_BADGE_STYLE[data.risk_level] }}>
            {data.risk_level}
          </span>
        </div>

        {/* Review focus */}
        {data.review_focus.length > 0 && (
          <>
            <div style={s.sectionLabel}>{t("block.brief.reviewFocus")}</div>
            <ul style={s.list}>
              {data.review_focus.map((item, i) => (
                <li key={i} style={s.listItem}>
                  <span style={s.bullet}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Risks */}
        {data.risks.length > 0 && (
          <>
            <div style={{ ...s.sectionLabel, marginTop: 16 }}>{t("block.risks")}</div>
            {data.risks.map((risk, i) => (
              <div key={i} style={s.riskCard}>
                <div style={s.riskHeader}>
                  <span style={s.riskTitle}>{risk.title}</span>
                  <span style={{ ...s.badge, ...RISK_BADGE_STYLE[risk.severity] }}>
                    {risk.severity}
                  </span>
                </div>
                <p style={s.riskExplanation}>{risk.explanation}</p>
                {risk.file_refs.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {risk.file_refs.map((ref, j) => (
                      <MonoLink
                        key={j}
                        href={canLink ? githubBlobUrl(repoFullName!, headSha!, ref) : undefined}
                      >
                        {ref}
                      </MonoLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* Footer: regenerate */}
        <div style={s.footer}>
          <button
            style={s.actionBtn}
            onClick={() => generate.mutate({ force: true })}
            disabled={generate.isPending}
          >
            {generate.isPending ? t("block.brief.regenerating") : t("block.brief.regenerate")}
          </button>
        </div>
      </div>
    </section>
  );
}
