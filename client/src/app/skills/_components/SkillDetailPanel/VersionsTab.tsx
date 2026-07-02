"use client";

import React from "react";
import { Button, Badge, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useRestoreSkillVersion } from "../../../../lib/hooks/skills";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function VersionsTab({
  skill,
  onRestored,
}: {
  skill: Skill;
  onRestored?: () => void;
}) {
  const { data: versions, isLoading, isError } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffVersion, setDiffVersion] = React.useState<number | null>(null);

  if (isLoading) return <div style={{ padding: 20 }}><Skeleton height={200} /></div>;
  if (isError) return <div style={{ padding: 20 }}><ErrorState body="Failed to load version history." /></div>;

  const sorted = [...(versions ?? [])].sort((a, b) => b.version - a.version);
  const currentVersion = skill.version;

  const diffEntry = diffVersion != null ? sorted.find((v) => v.version === diffVersion) : null;
  const nextEntry = diffVersion != null ? sorted.find((v) => v.version === diffVersion + 1) : null;

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Version history</span>
        <Badge color="var(--text-muted)">{sorted.length} versions</Badge>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
        Every save snapshots the body so eval runs stay reproducible against the exact text they scored.
      </p>

      {/* Diff modal */}
      {diffVersion != null && diffEntry && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setDiffVersion(null)}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              width: "min(860px, 92vw)",
              maxHeight: "80vh",
              overflow: "auto",
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Diff: v{nextEntry?.version ?? "–"} → v{diffEntry.version}
              </span>
              <button
                onClick={() => setDiffVersion(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}
              >
                ×
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  v{nextEntry?.version ?? "–"} (before)
                </div>
                <pre
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    maxHeight: 400,
                  }}
                >
                  {nextEntry?.body ?? "(no previous version)"}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  v{diffEntry.version} (after)
                </div>
                <pre
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    maxHeight: 400,
                  }}
                >
                  {diffEntry.body}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((v) => (
          <div
            key={v.version}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 8px",
                color: "var(--text-secondary)",
                flexShrink: 0,
              }}
            >
              v{v.version}
            </span>
            <span style={{ flex: 1, fontSize: 13, color: "var(--text-muted)" }}>
              {formatDate(v.created_at)}
            </span>
            {v.version === currentVersion && (
              <Badge color="var(--ok)">Current</Badge>
            )}
            {v.version < currentVersion && (
              <>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() => setDiffVersion(v.version)}
                >
                  Diff
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => {
                    if (!confirm(`Restore v${v.version}? This will create a new version.`)) return;
                    restore.mutate(
                      { skillId: skill.id, version: v.version },
                      { onSuccess: () => onRestored?.() },
                    );
                  }}
                >
                  Restore
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
