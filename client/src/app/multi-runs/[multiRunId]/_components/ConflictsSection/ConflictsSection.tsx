/* ConflictsSection — "Where agents disagree" with toggle and per-group rows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingGroup } from "@devdigest/shared";
import { s } from "./styles";

export interface ConflictsSectionProps {
  groups: FindingGroup[];
  showOnlyConflicts: boolean;
  onToggle: () => void;
  allAgentCount: number;
}

/**
 * Determine if a finding group represents a conflict:
 * ≥ 2 distinct verdict values, counting finding === null as "did_not_flag"
 * and any non-null finding as its severity string.
 */
function isConflict(group: FindingGroup): boolean {
  const verdicts = group.agent_verdicts.map((av) =>
    av.finding === null ? "did_not_flag" : (av.finding.severity ?? "unknown"),
  );
  const unique = new Set(verdicts);
  return unique.size >= 2;
}

export function ConflictsSection({
  groups,
  showOnlyConflicts,
  onToggle,
  allAgentCount,
}: ConflictsSectionProps) {
  const t = useTranslations("multiRuns");

  const displayedGroups = showOnlyConflicts
    ? groups.filter(isConflict)
    : groups;

  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <h2 style={s.title}>{t("results.conflicts.title")}</h2>

        <label style={s.toggleLabel}>
          <button
            type="button"
            role="switch"
            aria-checked={showOnlyConflicts}
            onClick={onToggle}
            style={{
              ...s.toggleSwitch,
              background: showOnlyConflicts ? "var(--accent-text)" : "var(--border)",
            }}
          >
            <span className="sr-only">
              {t("results.conflicts.showOnlyConflicts")}
            </span>
          </button>
          {t("results.conflicts.showOnlyConflicts")}
        </label>
      </div>

      {groups.length === 0 && allAgentCount < 2 ? (
        <div style={s.emptyNote}>
          {t("results.conflicts.requiresMultipleAgents")}
        </div>
      ) : displayedGroups.length === 0 ? null : (
        <div style={s.groupList}>
          {displayedGroups.map((group, gi) => (
            <div key={`${group.file}-${group.start_line}-${gi}`} style={s.group}>
              <div style={s.groupHeader}>
                {group.file} — lines {group.start_line}–{group.end_line}
              </div>
              <div style={s.verdictList}>
                {group.agent_verdicts.map((av, vi) => {
                  const isLast = vi === group.agent_verdicts.length - 1;
                  const rowStyle = isLast ? s.verdictLastRow : s.verdictRow;
                  return (
                    <div
                      key={`${av.agent_id ?? "unknown"}-${vi}`}
                      style={rowStyle}
                    >
                      <div style={s.agentNameCell}>
                        {av.agent_name ?? t("results.unknownAgent")}
                      </div>
                      {av.finding != null ? (
                        <div style={s.findingCell}>
                          <strong>{av.finding.severity}</strong>{" "}
                          {av.finding.title}
                        </div>
                      ) : (
                        <div style={s.didNotFlag}>
                          {t("results.conflicts.didNotFlag")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
