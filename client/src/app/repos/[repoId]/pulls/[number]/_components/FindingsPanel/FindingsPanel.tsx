/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { useTurnFindingIntoEvalCase } from "../../../../../../../lib/hooks/agents-eval";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  highlightedFindingId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Finding ID to transiently highlight (2 s ring) after a deep-link navigation. */
  highlightedFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const createEvalCase = useTurnFindingIntoEvalCase();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const [transientHighlightId, setTransientHighlightId] = React.useState<string | null>(null);

  // Apply a 2 s transient highlight whenever the parent signals a new target.
  React.useEffect(() => {
    if (!highlightedFindingId) return;
    setTransientHighlightId(highlightedFindingId);
    const handle = setTimeout(() => setTransientHighlightId(null), 2000);
    return () => clearTimeout(handle);
  }, [highlightedFindingId]);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx || f.id === transientHighlightId}
              defaultExpanded={i === 0}
              pending={action.isPending}
              evalCasePending={createEvalCase.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act, reply) => action.mutate({ findingId: f.id, action: act, reply, prId })}
              onCreateEvalCase={(kind, name) => createEvalCase.mutate({ findingId: f.id, kind, name })}
            />
          ))
        )}
      </div>
    </div>
  );
}
