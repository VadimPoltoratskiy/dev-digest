"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePriorPrs } from "@/lib/hooks/pr-files";
import { s } from "./styles";

interface ReviewFocusItemProps {
  prId: string;
  path: string;
}

/**
 * An expandable "Where to focus" item that lazily loads prior PRs
 * that touched the same file path on first expand (AC-6).
 * Each instance owns independent expanded state — no accordion.
 */
export function ReviewFocusItem({ prId, path }: ReviewFocusItemProps) {
  const t = useTranslations("brief");
  const { repoId } = useParams<{ repoId: string }>();
  const [expanded, setExpanded] = useState(false);
  const { isLoading, data } = usePriorPrs(prId, path, expanded);

  return (
    <li style={s.item}>
      {/* Toggle row: bullet + path text + expand/collapse indicator */}
      <button style={s.toggle} onClick={() => setExpanded((v) => !v)}>
        <span style={s.bullet}>•</span>
        <span style={s.path}>{path}</span>
        <span style={s.chevron}>{expanded ? "▲" : "▼"}</span>
        <span style={s.expandLabel}>
          {expanded
            ? t("block.brief.reviewFocus.collapse")
            : t("block.brief.reviewFocus.expand")}
        </span>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div style={s.panel}>
          {isLoading && (
            <span style={s.loading}>{t("block.brief.reviewFocus.loading")}</span>
          )}
          {!isLoading && data?.items.length === 0 && (
            <span style={s.empty}>{t("block.brief.reviewFocus.noPriorPrs")}</span>
          )}
          {!isLoading && data && data.items.length > 0 && (
            <>
              <div style={s.priorPrsLabel}>{t("block.brief.reviewFocus.priorPrs")}</div>
              <ul style={s.priorList}>
                {data.items.map((item) => (
                  <li key={item.number} style={s.priorItem}>
                    <a
                      href={`/repos/${repoId}/pulls/${item.number}`}
                      style={s.priorLink}
                    >
                      <span style={s.priorNumber}>#{item.number}</span>
                      <span style={s.priorTitle}>{item.title}</span>
                    </a>
                    <span style={s.priorMeta}>
                      {item.author} · {item.status}
                      {item.opened_at &&
                        ` · ${new Date(item.opened_at).toLocaleDateString()}`}
                    </span>
                  </li>
                ))}
              </ul>
              {data.total > data.items.length && (
                <span style={s.truncation}>
                  {t("block.brief.reviewFocus.truncation", {
                    shown: data.items.length,
                    total: data.total,
                  })}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
