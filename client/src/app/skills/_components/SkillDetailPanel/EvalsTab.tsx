"use client";

import React from "react";
import { Button, Badge, Skeleton, ErrorState, FormField, TextInput, Textarea } from "@devdigest/ui";
import { Icon } from "@devdigest/ui";
import type { Skill, SkillEvalCase } from "@devdigest/shared";
import {
  useSkillEvalCases,
  useCreateEvalCase,
  useDeleteEvalCase,
  useRunEvalCase,
  useRunAllEvalCases,
} from "../../../../lib/hooks/skills";

function StatusIcon({ evalCase }: { evalCase: SkillEvalCase }) {
  if (!evalCase.latest_run) {
    return (
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "2px solid var(--border)",
          display: "inline-block",
          flexShrink: 0,
        }}
        title="Never run"
      />
    );
  }
  return evalCase.latest_run.passed ? (
    <Icon.CheckCircle size={20} style={{ color: "var(--ok)", flexShrink: 0 }} />
  ) : (
    <Icon.XCircle size={20} style={{ color: "var(--crit)", flexShrink: 0 }} />
  );
}

function SeverityBadge({ category, severity }: { category?: string | null; severity?: string | null }) {
  if (!category && !severity) return null;
  const label = [severity, category].filter(Boolean).join(" · ");
  const color = severity?.toUpperCase() === "CRITICAL" ? "var(--crit)" : "var(--warn)";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: color + "18",
        padding: "2px 7px",
        borderRadius: 4,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export function EvalsTab({ skill }: { skill: Skill }) {
  const { data: cases, isLoading, isError } = useSkillEvalCases(skill.id);
  const createCase = useCreateEvalCase(skill.id);
  const deleteCase = useDeleteEvalCase(skill.id);
  const runCase = useRunEvalCase(skill.id);
  const runAll = useRunAllEvalCases(skill.id);

  const [showForm, setShowForm] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newDiff, setNewDiff] = React.useState("");
  const [newCount, setNewCount] = React.useState("1");
  const [newCategory, setNewCategory] = React.useState("");
  const [newSeverity, setNewSeverity] = React.useState("");

  const runningCaseId = runCase.variables as string | undefined;

  if (isLoading) return <div style={{ padding: 20 }}><Skeleton height={200} /></div>;
  if (isError) return <div style={{ padding: 20 }}><ErrorState body="Failed to load eval cases." /></div>;

  const total = cases?.length ?? 0;
  const passing = cases?.filter((c) => c.latest_run?.passed).length ?? 0;

  const submit = () => {
    if (!newName.trim() || !newDiff.trim()) return;
    createCase.mutate(
      {
        name: newName.trim(),
        input_diff: newDiff.trim(),
        expected_finding_count: parseInt(newCount, 10) || 1,
        category: newCategory.trim() || undefined,
        severity: newSeverity.trim() || undefined,
      },
      {
        onSuccess: () => {
          setNewName("");
          setNewDiff("");
          setNewCount("1");
          setNewCategory("");
          setNewSeverity("");
          setShowForm(false);
        },
      },
    );
  };

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Eval cases</span>
        {total > 0 && (
          <Badge color={passing === total ? "var(--ok)" : "var(--warn)"}>
            {passing}/{total} passing
          </Badge>
        )}
        <Button
          kind="ghost"
          size="sm"
          icon="Play"
          disabled={runAll.isPending || total === 0}
          onClick={() => runAll.mutate()}
        >
          {runAll.isPending ? "Running…" : "Run all evals"}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setShowForm((v) => !v)}>
          New eval case
        </Button>
      </div>

      {/* New case form */}
      {showForm && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            background: "var(--bg-elevated)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <FormField label="Name" required>
            <TextInput value={newName} onChange={setNewName} placeholder="e.g. stripe-key-leak" />
          </FormField>
          <FormField label="Diff fixture" required hint="Paste the raw unified diff this case should be tested against.">
            <Textarea value={newDiff} onChange={setNewDiff} rows={6} mono placeholder={"--- a/file.ts\n+++ b/file.ts\n@@ ..."} />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FormField label="Expected findings">
              <TextInput value={newCount} onChange={setNewCount} />
            </FormField>
            <FormField label="Category">
              <TextInput value={newCategory} onChange={setNewCategory} placeholder="security" />
            </FormField>
            <FormField label="Severity">
              <TextInput value={newSeverity} onChange={setNewSeverity} placeholder="CRITICAL" />
            </FormField>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="primary" size="sm" onClick={submit} disabled={createCase.isPending}>
              {createCase.isPending ? "Saving…" : "Save case"}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Cases list */}
      {total === 0 && !showForm && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No eval cases yet. Create one to start testing this skill against known diffs.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cases?.map((c) => {
          const isRunning = runCase.isPending && runningCaseId === c.id;
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--bg-elevated)",
              }}
            >
              <StatusIcon evalCase={c} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {c.latest_run
                    ? `expected ${c.expected.expected_finding_count} finding${c.expected.expected_finding_count !== 1 ? "s" : ""}, got ${c.latest_run.actual_finding_count}`
                    : "never run"}
                </div>
              </div>
              <SeverityBadge category={c.expected.category} severity={c.expected.severity} />
              <button
                onClick={() => !isRunning && runCase.mutate(c.id)}
                disabled={isRunning}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: isRunning ? "wait" : "pointer",
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-secondary)",
                }}
                title="Run"
              >
                <Icon.Play size={13} />
              </button>
              <button
                onClick={() => {
                  if (!confirm(`Delete eval case "${c.name}"?`)) return;
                  deleteCase.mutate(c.id);
                }}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-muted)",
                }}
                title="Delete"
              >
                <Icon.Trash size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
