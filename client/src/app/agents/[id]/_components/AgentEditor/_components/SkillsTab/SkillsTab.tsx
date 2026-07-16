"use client";

import React from "react";
import { Icon, Toggle, Button, Skeleton, ErrorState, Badge } from "@devdigest/ui";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import {
  useAgentSkills,
  useSkills,
  useSetAgentSkills,
  useLinkSkill,
  useUnlinkSkill,
  useToggleSkill,
} from "../../../../../../../lib/hooks/skills";
import { SKILL_TYPE_COLORS as TYPE_COLORS } from "../../../../../../../lib/skill-colors";
import { s } from "./styles";

/** Agent editor → Skills tab. Lists linked skills in order + add/remove/reorder UI. */
export function SkillsTab({ agentId }: { agentId: string }) {
  const { data: links, isLoading, isError, refetch } = useAgentSkills(agentId);
  const { data: allSkills } = useSkills();
  const setSkills = useSetAgentSkills();
  const linkSkill = useLinkSkill();
  const unlinkSkill = useUnlinkSkill();
  const toggleSkill = useToggleSkill();

  const [addOpen, setAddOpen] = React.useState(false);

  /** Index of the row currently being dragged (-1 = none) */
  const [dragSrc, setDragSrc] = React.useState<number | null>(null);
  /** Index of the row the dragged item is currently hovering over */
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={200} />;
  if (isError) return <ErrorState body="Could not load skills." onRetry={() => refetch()} />;

  const sorted = [...(links ?? [])].sort((a, b) => a.order - b.order);
  const linkedIds = new Set(sorted.map((l) => l.skill_id));
  const unlinked = (allSkills ?? []).filter((sk) => !linkedIds.has(sk.id));

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const newOrder = sorted.map((l) => l.skill_id);
    const tmp = newOrder[idx - 1]!;
    newOrder[idx - 1] = newOrder[idx]!;
    newOrder[idx] = tmp;
    setSkills.mutate({ agentId, skillIds: newOrder });
  };

  const moveDown = (idx: number) => {
    if (idx === sorted.length - 1) return;
    const newOrder = sorted.map((l) => l.skill_id);
    const tmp = newOrder[idx]!;
    newOrder[idx] = newOrder[idx + 1]!;
    newOrder[idx + 1] = tmp;
    setSkills.mutate({ agentId, skillIds: newOrder });
  };

  const resetDragState = () => {
    setDragSrc(null);
    setDragOver(null);
  };

  const handleDrop = (targetIdx: number) => {
    if (dragSrc === null || dragSrc === targetIdx) {
      resetDragState();
      return;
    }
    // Remove the source id and splice it into the target position.
    const ids = sorted.map((l) => l.skill_id);
    const [removed] = ids.splice(dragSrc, 1);
    ids.splice(targetIdx, 0, removed!);
    setSkills.mutate({ agentId, skillIds: ids });
    resetDragState();
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>Skills</h2>
          <p style={s.hint}>Order determines the sequence of blocks assembled into the prompt.</p>
        </div>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setAddOpen((v) => !v)}>
          Add skill
        </Button>
      </div>

      {sorted.length === 0 && (
        <div style={s.emptyBox}>No skills linked yet. Add one to encode rules into this agent's prompt.</div>
      )}

      {sorted.map((link, idx) => (
        <LinkedSkillRow
          key={link.skill_id}
          link={link}
          allSkills={allSkills ?? []}
          idx={idx}
          total={sorted.length}
          onMoveUp={() => moveUp(idx)}
          onMoveDown={() => moveDown(idx)}
          onUnlink={() => unlinkSkill.mutate({ agentId, skillId: link.skill_id })}
          onToggle={(enabled) => toggleSkill.mutate({ id: link.skill_id, enabled })}
          isDragOver={dragOver === idx}
          onDragStart={(e) => {
            setDragSrc(idx);
            // dataTransfer is non-null per spec; guard for jsdom test environments
            // where synthetic DragEvents may not carry a DataTransfer object.
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(idx);
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(idx);
          }}
          onDragEnd={resetDragState}
        />
      ))}

      {addOpen && unlinked.length > 0 && (
        <div style={s.addSection}>
          <div style={s.addLabel}>Link a skill from this workspace:</div>
          {unlinked.map((sk) => (
            <div key={sk.id} style={{ ...s.skillRow, opacity: sk.enabled ? 1 : 0.6 }}>
              <span style={s.skillName}>{sk.name}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: TYPE_COLORS[sk.type] ?? "var(--text-secondary)",
                  background: (TYPE_COLORS[sk.type] ?? "var(--text-secondary)") + "1a",
                  padding: "2px 7px",
                  borderRadius: 4,
                }}
              >
                {sk.type}
              </span>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  linkSkill.mutate({ agentId, skillId: sk.id });
                  setAddOpen(false);
                }}
              >
                Link
              </Button>
            </div>
          ))}
        </div>
      )}
      {addOpen && unlinked.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 16 }}>
          All workspace skills are already linked.
        </p>
      )}
    </div>
  );
}

function LinkedSkillRow({
  link,
  allSkills,
  idx,
  total,
  onMoveUp,
  onMoveDown,
  onUnlink,
  onToggle,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  link: AgentSkillLink;
  allSkills: Skill[];
  idx: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUnlink: () => void;
  onToggle: (enabled: boolean) => void;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const skill = allSkills.find((sk) => sk.id === link.skill_id);
  const typeColor = skill ? (TYPE_COLORS[skill.type] ?? "var(--text-secondary)") : "var(--text-secondary)";

  const rowStyle = isDragOver
    ? { ...s.skillRow, ...s.skillRowDragOver }
    : s.skillRow;

  return (
    <div
      style={rowStyle}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Drag handle */}
      <button style={s.dragHandle} aria-label="Drag to reorder" tabIndex={-1}>
        <Icon.Menu size={14} />
      </button>

      {/* Order position number */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          minWidth: 18,
          textAlign: "center",
        }}
      >
        {idx + 1}
      </span>

      {/* Up/Down arrows */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <button style={s.orderBtn} onClick={onMoveUp} disabled={idx === 0} aria-label="Move up">
          <Icon.ArrowUp size={12} />
        </button>
        <button style={s.orderBtn} onClick={onMoveDown} disabled={idx === total - 1} aria-label="Move down">
          <Icon.ArrowDown size={12} />
        </button>
      </div>

      <span style={s.skillName}>{skill?.name ?? link.skill_id}</span>

      {skill && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: typeColor,
            background: typeColor + "1a",
            padding: "2px 7px",
            borderRadius: 4,
          }}
        >
          {skill.type}
        </span>
      )}

      {skill && (
        <Toggle
          on={skill.enabled}
          onChange={onToggle}
          size={13}
        />
      )}

      {skill && !skill.enabled && (
        <Badge color="#f59e0b" icon="AlertTriangle">
          disabled
        </Badge>
      )}

      <button style={s.unlinkBtn} onClick={onUnlink} title="Unlink skill" aria-label="Unlink skill">
        <Icon.X size={14} />
      </button>
    </div>
  );
}
