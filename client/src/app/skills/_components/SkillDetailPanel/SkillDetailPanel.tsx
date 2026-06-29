"use client";

import React from "react";
import { Button, Badge, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useToggleSkill, useRunAllEvalCases } from "../../../../lib/hooks/skills";
import { ConfigTab } from "./ConfigTab";
import { PreviewTab } from "./PreviewTab";
import { EvalsTab } from "./EvalsTab";
import { StatsTab } from "./StatsTab";
import { VersionsTab } from "./VersionsTab";
import { TYPE_COLORS } from "../SkillsListView/constants";

const TABS = [
  { key: "config", label: "Config" },
  { key: "preview", label: "Preview" },
  { key: "evals", label: "Evals" },
  { key: "stats", label: "Stats" },
  { key: "versions", label: "Versions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function SkillDetailPanel({
  skill,
  onClose,
  onUpdated,
}: {
  skill: Skill;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [tab, setTab] = React.useState<TabKey>("config");
  const toggle = useToggleSkill();
  const runAll = useRunAllEvalCases(skill.id);
  const typeColor = TYPE_COLORS[skill.type] ?? "var(--text-secondary)";

  // Reset to Config tab when selected skill changes.
  React.useEffect(() => {
    setTab("config");
  }, [skill.id]);

  return (
    <div
      style={{
        flex: 1,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {skill.name}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: typeColor,
            background: typeColor + "1a",
            padding: "2px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {skill.type}
        </span>
        <Badge icon="GitBranch" color="var(--text-muted)">
          v{skill.version}
        </Badge>
        <Button
          kind="ghost"
          size="sm"
          icon="Play"
          disabled={runAll.isPending}
          onClick={() => runAll.mutate()}
        >
          {runAll.isPending ? "Running…" : "Run on evals"}
        </Button>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            padding: 2,
          }}
          aria-label="Close panel"
        >
          <Icon.X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          padding: "0 16px",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)",
              marginBottom: -1,
              transition: "color 0.1s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "config" && (
          <ConfigTab
            skill={skill}
            onUpdated={() => onUpdated?.()}
          />
        )}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && <EvalsTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && (
          <VersionsTab
            skill={skill}
            onRestored={() => { onUpdated?.(); setTab("config"); }}
          />
        )}
      </div>
    </div>
  );
}
