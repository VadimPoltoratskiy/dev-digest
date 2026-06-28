"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLORS } from "./constants";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const typeColor = TYPE_COLORS[skill.type] ?? "var(--text-secondary)";

  return (
    <div
      onClick={onClick}
      style={{
        padding: 14,
        borderRadius: 8,
        cursor: "pointer",
        border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
        background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
        opacity: skill.enabled ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: typeColor + "1a",
            color: typeColor,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Sparkles size={13} />
        </div>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          margin: "8px 0",
          lineHeight: 1.4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {skill.description}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          }}
        >
          {t(`listItem.type.${skill.type}`)}
        </span>
        {!skill.enabled && skill.source !== "manual" && (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
            title={t("listItem.vettingTitle")}
          >
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>
    </div>
  );
}
