/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Textarea,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "@/lib/github-urls";
import { CreateEvalCaseModal } from "./CreateEvalCaseModal";
import { LearnModal } from "./LearnModal";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  onCreateEvalCase,
  onLearn,
  pending,
  evalCasePending,
  learnPending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  onCreateEvalCase?: (kind: "must_find" | "must_not_flag", name: string) => void;
  onLearn?: (body: { content: string; scope: string; kind: string }) => void;
  pending?: boolean;
  evalCasePending?: boolean;
  learnPending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [evalModalOpen, setEvalModalOpen] = React.useState(false);
  const [learnModalOpen, setLearnModalOpen] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {muted && (
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={evalCasePending}
                onClick={() => setEvalModalOpen(true)}
                aria-label={t("finding.createEvalCase")}
              >
                {t("finding.createEvalCase")}
              </Button>
            )}
            {muted && (
              <Button
                kind="ghost"
                size="sm"
                icon="Brain"
                disabled={learnPending}
                onClick={() => setLearnModalOpen(true)}
                aria-label={t("finding.learn")}
              >
                {t("finding.learn")}
              </Button>
            )}
            <Button
              kind="ghost"
              size="sm"
              icon="MessageSquare"
              disabled={pending}
              active={replying}
              onClick={() => setReplying((r) => !r)}
              aria-label={t("finding.replyToAuthor")}
            >
              {t("finding.replyToAuthor")}
            </Button>
          </div>

          {replying && (
            <div style={s.composer}>
              <Textarea
                value={replyText}
                onChange={setReplyText}
                rows={3}
                placeholder={t("finding.replyPlaceholder")}
              />
              <div style={s.composerActions}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="MessageSquare"
                  loading={pending}
                  disabled={pending || !replyText.trim()}
                  onClick={() => {
                    onAction?.("reply", replyText.trim());
                    setReplyText("");
                    setReplying(false);
                  }}
                >
                  {t("finding.sendReply")}
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setReplying(false)}
                >
                  {t("finding.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {evalModalOpen && (
        <CreateEvalCaseModal
          f={f}
          pending={evalCasePending}
          onClose={() => setEvalModalOpen(false)}
          onSubmit={(kind, name) => {
            onCreateEvalCase?.(kind, name);
            setEvalModalOpen(false);
          }}
        />
      )}
      {learnModalOpen && (
        <LearnModal
          f={f}
          pending={learnPending}
          onClose={() => setLearnModalOpen(false)}
          onSubmit={(body) => {
            onLearn?.(body);
            setLearnModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
