/* SmartDiffViewer — groups a PR's files by risk (core/wiring/boilerplate,
   from GET /pulls/:id/smart-diff) instead of GitHub's raw order. Boilerplate
   starts collapsed; each file carries the latest review's finding lines as a
   clickable badge (FileCard renders it). */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiff, SmartDiffRole } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s, chevronFor } from "../styles";
import { FileCard } from "../FileCard";
import { DiffViewer } from "../DiffViewer";
import { ROLE_META, ROLE_ORDER } from "./constants";

function RoleGroup({
  role,
  filePaths,
  filesByPath,
  commenting,
  findingLinesByPath,
  onOpenWhy,
}: {
  role: SmartDiffRole;
  filePaths: string[];
  filesByPath: Map<string, PrFile>;
  commenting?: DiffCommentApi;
  findingLinesByPath: Map<string, number[]>;
  onOpenWhy?: (path: string, line: number) => void;
}) {
  const meta = ROLE_META[role];
  const [open, setOpen] = React.useState(!meta.collapsedByDefault);
  const [fileOpen, setFileOpen] = React.useState<Record<string, boolean>>({});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          cursor: "pointer",
          padding: "4px 2px",
        }}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{meta.hint}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filePaths.length} file{filePaths.length === 1 ? "" : "s"}
        </span>
      </div>
      {open && (
        <div style={s.list}>
          {filePaths.map((path) => {
            const file = filesByPath.get(path);
            if (!file) return null;
            return (
              <FileCard
                key={path}
                file={file}
                commenting={commenting}
                findingLines={findingLinesByPath.get(path)}
                open={fileOpen[path]}
                onToggle={(next) => setFileOpen((prev) => ({ ...prev, [path]: next }))}
                onOpenWhy={onOpenWhy}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({
  files,
  smartDiff,
  commenting,
  onOpenWhy,
}: {
  files: PrFile[];
  smartDiff: SmartDiff | undefined;
  commenting?: DiffCommentApi;
  onOpenWhy?: (path: string, line: number) => void;
}) {
  if (!smartDiff) {
    // Not loaded yet (or endpoint unreachable) — fall back to the plain list
    // rather than blocking the diff tab on this extra call.
    return <DiffViewer files={files} commenting={commenting} onOpenWhy={onOpenWhy} />;
  }

  const filesByPath = new Map(files.map((f) => [f.path, f]));
  const groupsByRole = new Map(smartDiff.groups.map((g) => [g.role, g]));
  const findingLinesByPath = new Map(
    smartDiff.groups.flatMap((g) => g.files.map((f) => [f.path, f.finding_lines] as const)),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {ROLE_ORDER.map((role) => {
        const group = groupsByRole.get(role);
        if (!group || group.files.length === 0) return null;
        return (
          <RoleGroup
            key={role}
            role={role}
            filePaths={group.files.map((f) => f.path)}
            filesByPath={filesByPath}
            commenting={commenting}
            findingLinesByPath={findingLinesByPath}
            onOpenWhy={onOpenWhy}
          />
        );
      })}
    </div>
  );
}
