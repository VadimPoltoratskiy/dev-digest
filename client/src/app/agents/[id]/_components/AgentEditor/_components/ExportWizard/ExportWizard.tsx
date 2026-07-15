"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, ExportWizardSteps, Badge } from "@devdigest/ui";
import type { CiFile, CiTarget } from "@devdigest/shared";
import { useExportCi, useCiPreflight } from "../../../../../../../lib/hooks";
import type { CiPreflightResult } from "../../../../../../../lib/api";
import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportWizardProps {
  agentId: string;
  open: boolean;
  onClose: () => void;
  /** Pre-fill the repo field for "Update CI config" re-opens. */
  prefilledRepo?: string;
}

type PostAs = "github_review" | "pr_comment" | "exit_code_only";
type Step = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Step 1 — Target
// ---------------------------------------------------------------------------

interface TargetStepProps {
  target: CiTarget;
  onTargetChange: (t: CiTarget) => void;
  repo: string;
  onRepoChange: (r: string) => void;
  base: string;
  onBaseChange: (b: string) => void;
  onNext: () => void;
  isLoading: boolean;
  t: ReturnType<typeof useTranslations>;
}

function TargetStep({
  target,
  onTargetChange,
  repo,
  onRepoChange,
  base,
  onBaseChange,
  onNext,
  isLoading,
  t,
}: TargetStepProps) {
  const providers: Array<{ key: CiTarget; label: string; recommended?: boolean; comingSoon?: boolean }> = [
    { key: "gha", label: t("ci.wizard.providerGha"), recommended: true },
    { key: "circle", label: t("ci.wizard.providerCircle"), comingSoon: true },
    { key: "jenkins", label: t("ci.wizard.providerJenkins"), comingSoon: true },
    { key: "cli", label: t("ci.wizard.providerCli"), comingSoon: true },
  ];

  const canNext = repo.trim().length > 0;

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Provider selector */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>CI Provider</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {providers.map((p) => (
            <label
              key={p.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                border: `1px solid ${target === p.key ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 8,
                background: p.comingSoon ? "var(--bg-surface)" : "var(--bg-elevated)",
                cursor: p.comingSoon ? "not-allowed" : "pointer",
                opacity: p.comingSoon ? 0.5 : 1,
              }}
            >
              <input
                type="radio"
                name="ci-target"
                value={p.key}
                checked={target === p.key}
                disabled={!!p.comingSoon}
                onChange={() => onTargetChange(p.key)}
                style={{ flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.label}</span>
              {p.recommended && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--accent)",
                    background: "var(--accent-bg, #4f46e51a)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    textTransform: "uppercase" as const,
                  }}
                >
                  {t("ci.wizard.ghaRecommended")}
                </span>
              )}
              {p.comingSoon && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                  }}
                >
                  {t("ci.wizard.comingSoon")}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Repo input */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
          {t("ci.wizard.repoLabel")}
        </label>
        <input
          type="text"
          value={repo}
          onChange={(e) => onRepoChange(e.target.value)}
          placeholder={t("ci.wizard.repoPlaceholder")}
          style={{
            width: "100%",
            boxSizing: "border-box" as const,
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        />
      </div>

      {/* Base branch input */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
          {t("ci.wizard.baseBranchLabel")}
        </label>
        <input
          type="text"
          value={base}
          onChange={(e) => onBaseChange(e.target.value)}
          placeholder="main"
          style={{
            width: "100%",
            boxSizing: "border-box" as const,
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          kind="primary"
          size="sm"
          disabled={!canNext || isLoading}
          onClick={onNext}
        >
          {isLoading ? "Loading…" : t("ci.wizard.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Preview
// ---------------------------------------------------------------------------

interface PreviewStepProps {
  files: CiFile[];
  editedWorkflow: string;
  onWorkflowChange: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
  t: ReturnType<typeof useTranslations>;
}

function PreviewStep({ files, editedWorkflow, onWorkflowChange, onBack, onNext, t }: PreviewStepProps) {
  const workflowFile = files.find((f) => f.path.endsWith("devdigest-review.yml"));

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* File list */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t("ci.wizard.filesTitle")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map((f) => (
            <div
              key={f.path}
              style={{
                padding: "6px 10px",
                background: "var(--bg-surface)",
                borderRadius: 5,
                fontFamily: "monospace",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>{f.path}</span>
              {f.editable && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>editable</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editable workflow textarea */}
      {workflowFile && (
        <div>
          <label
            id="workflow-label"
            style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}
          >
            {t("ci.wizard.workflowLabel")}
          </label>
          <textarea
            aria-labelledby="workflow-label"
            value={editedWorkflow}
            onChange={(e) => onWorkflowChange(e.target.value)}
            rows={16}
            style={{
              width: "100%",
              boxSizing: "border-box" as const,
              padding: "10px 12px",
              fontFamily: "monospace",
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              resize: "vertical" as const,
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button kind="ghost" size="sm" onClick={onBack}>
          {t("ci.wizard.back")}
        </Button>
        <Button kind="primary" size="sm" onClick={onNext}>
          {t("ci.wizard.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Configure
// ---------------------------------------------------------------------------

interface ConfigureStepProps {
  triggers: string[];
  onTriggersChange: (triggers: string[]) => void;
  postAs: PostAs;
  onPostAsChange: (p: PostAs) => void;
  onBack: () => void;
  onNext: () => void;
  t: ReturnType<typeof useTranslations>;
  secretStatus?: CiPreflightResult["secrets"];
  secretStatusLoading: boolean;
}

/** Green "ready" / orange "not set" status pill for a secret. Loading = neutral, no premature red/orange flash. */
function SecretStatusBadge({
  ready,
  loading,
  t,
}: {
  ready: boolean | undefined;
  loading: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  if (loading) {
    return (
      <Badge color="var(--text-muted)" bg="var(--bg-hover)" dot>
        {t("ci.wizard.secretsPanel.checking")}
      </Badge>
    );
  }
  return ready ? (
    <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
      {t("ci.wizard.secretsPanel.ready")}
    </Badge>
  ) : (
    <Badge color="var(--warn)" bg="var(--warn-bg)" dot>
      {t("ci.wizard.secretsPanel.notSet")}
    </Badge>
  );
}

function ConfigureStep({
  triggers,
  onTriggersChange,
  postAs,
  onPostAsChange,
  onBack,
  onNext,
  t,
  secretStatus,
  secretStatusLoading,
}: ConfigureStepProps) {
  const triggerOptions = ["opened", "synchronize", "reopened"] as const;
  const postAsOptions: Array<{ value: PostAs; labelKey: string }> = [
    { value: "github_review", labelKey: "ci.wizard.postAs.github_review" },
    { value: "pr_comment", labelKey: "ci.wizard.postAs.pr_comment" },
    { value: "exit_code_only", labelKey: "ci.wizard.postAs.exit_code_only" },
  ];

  const toggleTrigger = (trigger: string) => {
    if (triggers.includes(trigger)) {
      onTriggersChange(triggers.filter((t) => t !== trigger));
    } else {
      onTriggersChange([...triggers, trigger]);
    }
  };

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Triggers */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t("ci.wizard.triggersLabel")}</div>
        {triggerOptions.map((trigger) => (
          <label
            key={trigger}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={triggers.includes(trigger)}
              onChange={() => toggleTrigger(trigger)}
            />
            <code style={{ fontFamily: "monospace", fontSize: 12 }}>{trigger}</code>
          </label>
        ))}
      </div>

      {/* Post results as */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t("ci.wizard.postAs.label")}</div>
        {postAsOptions.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="radio"
              name="post-as"
              value={opt.value}
              checked={postAs === opt.value}
              onChange={() => onPostAsChange(opt.value)}
            />
            {t(opt.labelKey as Parameters<typeof t>[0])}
          </label>
        ))}
      </div>

      {/* Secrets panel */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
          {t("ci.wizard.secretsPanel.title")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                {t("ci.wizard.secretsPanel.openrouterKey")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("ci.wizard.secretsPanel.openrouterKeyHint")}
              </div>
            </div>
            <SecretStatusBadge
              ready={secretStatus?.openrouter_api_key}
              loading={secretStatusLoading}
              t={t}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                {t("ci.wizard.secretsPanel.githubToken")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("ci.wizard.secretsPanel.githubTokenHint")}
              </div>
            </div>
            <SecretStatusBadge ready={secretStatus?.github_token ?? true} loading={false} t={t} />
          </div>
        </div>
      </div>

      {/* Branch protection hint */}
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
        {t("ci.wizard.branchProtectionHint")}
      </p>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button kind="ghost" size="sm" onClick={onBack}>
          {t("ci.wizard.back")}
        </Button>
        <Button kind="primary" size="sm" onClick={onNext}>
          {t("ci.wizard.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Install
// ---------------------------------------------------------------------------

interface InstallStepProps {
  agentId: string;
  repo: string;
  target: CiTarget;
  base: string;
  triggers: string[];
  postAs: PostAs;
  files: CiFile[];
  editedWorkflow: string;
  onBack: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
  preflightData: CiPreflightResult | undefined;
  preflightLoading: boolean;
}

function InstallStep({
  agentId,
  repo,
  target,
  base,
  triggers,
  postAs,
  files,
  editedWorkflow,
  onBack,
  onClose,
  t,
  preflightData,
  preflightLoading,
}: InstallStepProps) {
  const exportMutation = useExportCi(agentId);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);

  const hasWriteAccess = preflightData?.has_write_access ?? false;
  const isGha = target === "gha";

  // Build the files array substituting the edited workflow YAML
  const getFilesWithEdits = (): CiFile[] =>
    files.map((f) =>
      f.path.endsWith("devdigest-review.yml") ? { ...f, contents: editedWorkflow } : f,
    );

  const handleOpenPr = async () => {
    const result = await exportMutation.mutateAsync({
      repo,
      target,
      action: "open_pr",
      post_as: postAs,
      triggers,
      base,
    });
    if (result.pr_url) {
      setPrUrl(result.pr_url);
    }
  };

  const handleCopyZip = async () => {
    const zip = new JSZip();
    for (const file of getFilesWithEdits()) {
      zip.file(file.path, file.contents);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "devdigest-ci.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (prUrl) {
    return (
      <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("ci.wizard.openPr")}</p>
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", fontSize: 13 }}
        >
          {prUrl}
        </a>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button kind="primary" size="sm" onClick={onClose}>
            {t("ci.wizard.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Open PR option (GHA only) */}
      {isGha && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elevated)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("ci.wizard.openPr")}</div>

          {preflightLoading && (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Checking write access…</p>
          )}

          {!preflightLoading && !hasWriteAccess && (
            <p style={{ fontSize: 12, color: "var(--warn)", margin: "0 0 10px" }}>
              {t("ci.wizard.noWriteAccess")}
            </p>
          )}

          {exportMutation.isError && (
            <p style={{ fontSize: 12, color: "var(--crit)", margin: "0 0 10px" }}>
              {(exportMutation.error as Error).message}
            </p>
          )}

          <Button
            kind="primary"
            size="sm"
            disabled={!hasWriteAccess || preflightLoading || exportMutation.isPending}
            onClick={handleOpenPr}
          >
            {exportMutation.isPending ? t("ci.wizard.installing") : t("ci.wizard.openPr")}
          </Button>
        </div>
      )}

      {/* Copy as ZIP */}
      <div
        style={{
          padding: 16,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-elevated)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("ci.wizard.copyZip")}</div>
        <Button kind="secondary" size="sm" onClick={handleCopyZip}>
          {t("ci.wizard.copyZip")}
        </Button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button kind="ghost" size="sm" onClick={onBack}>
          {t("ci.wizard.back")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ExportWizard component
// ---------------------------------------------------------------------------

export function ExportWizard({ agentId, open, onClose, prefilledRepo }: ExportWizardProps) {
  const t = useTranslations("agents");

  const [step, setStep] = React.useState<Step>(1);
  const [target, setTarget] = React.useState<CiTarget>("gha");
  const [repo, setRepo] = React.useState(prefilledRepo ?? "");
  const [base, setBase] = React.useState("main");
  const [triggers, setTriggers] = React.useState<string[]>(["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [files, setFiles] = React.useState<CiFile[]>([]);
  const [editedWorkflow, setEditedWorkflow] = React.useState("");

  const exportFiles = useExportCi(agentId);
  // Owned here (not in ConfigureStep/InstallStep) so both steps share one
  // query/cache entry instead of re-fetching independently.
  const preflight = useCiPreflight(target === "gha" ? repo : null);

  // Reset when re-opened with a different prefilledRepo
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setRepo(prefilledRepo ?? "");
      setFiles([]);
      setEditedWorkflow("");
    }
  }, [open, prefilledRepo]);

  if (!open) return null;

  const stepLabels = [
    t("ci.wizard.step1"),
    t("ci.wizard.step2"),
    t("ci.wizard.step3"),
    t("ci.wizard.step4"),
  ];

  const handleStep1Next = async () => {
    try {
      const result = await exportFiles.mutateAsync({
        repo,
        target,
        action: "files",
        post_as: postAs,
        triggers,
        base,
      });
      const workflowFile = result.files.find((f: CiFile) => f.path.endsWith("devdigest-review.yml"));
      setFiles(result.files);
      setEditedWorkflow(workflowFile?.contents ?? "");
      setStep(2);
    } catch {
      // error visible via exportFiles.isError
    }
  };

  return (
    <Modal
      title={t("ci.wizard.title")}
      onClose={onClose}
      width={760}
      footer={null}
    >
      {/* Step indicator */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
        <ol role="list" style={{ padding: 0, margin: 0, listStyle: "none" }}>
          <ExportWizardSteps step={step - 1} labels={stepLabels} />
        </ol>
      </div>

      {/* Step content */}
      {step === 1 && (
        <TargetStep
          target={target}
          onTargetChange={setTarget}
          repo={repo}
          onRepoChange={setRepo}
          base={base}
          onBaseChange={setBase}
          onNext={handleStep1Next}
          isLoading={exportFiles.isPending}
          t={t}
        />
      )}
      {step === 2 && (
        <PreviewStep
          files={files}
          editedWorkflow={editedWorkflow}
          onWorkflowChange={setEditedWorkflow}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          t={t}
        />
      )}
      {step === 3 && (
        <ConfigureStep
          triggers={triggers}
          onTriggersChange={setTriggers}
          postAs={postAs}
          onPostAsChange={setPostAs}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
          t={t}
          secretStatus={preflight.data?.secrets}
          secretStatusLoading={preflight.isLoading}
        />
      )}
      {step === 4 && (
        <InstallStep
          agentId={agentId}
          repo={repo}
          target={target}
          base={base}
          triggers={triggers}
          postAs={postAs}
          files={files}
          editedWorkflow={editedWorkflow}
          onBack={() => setStep(3)}
          onClose={onClose}
          t={t}
          preflightData={preflight.data}
          preflightLoading={preflight.isLoading}
        />
      )}
    </Modal>
  );
}
