"use client";

/**
 * ComposeReviewDrawer — slide-over drawer that lets the user post a
 * human-curated GitHub PR review (verdict + selected findings as inline
 * comments). Triggered from PrDetailHeader.
 *
 * SPEC-04 acceptance criteria covered: AC-2 through AC-14.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { usePostComposeReview } from "@/lib/hooks/reviews";

export interface ComposeReviewDrawerProps {
  prId: string;
  open: boolean;
  onClose: () => void;
  allFindings: FindingRecord[];
}

type Verdict = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

export function ComposeReviewDrawer({
  prId,
  open,
  onClose,
  allFindings,
}: ComposeReviewDrawerProps) {
  const t = useTranslations("compose.reviewDrawer");

  // ---- Component state ----
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [body, setBody] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [postedReviewId, setPostedReviewId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const mutation = usePostComposeReview(prId);

  // Use a ref so the open-init effect always sees the latest allFindings
  // without needing allFindings in the dep array (which would reset state
  // mid-session on every finding action while the drawer is open).
  const allFindingsRef = React.useRef(allFindings);
  allFindingsRef.current = allFindings;

  // AC-5, AC-14: re-initialize all state on each open so re-opening starts fresh.
  React.useEffect(() => {
    if (!open) return;
    const initial = allFindingsRef.current
      .filter((f) => f.accepted_at !== null && f.dismissed_at === null)
      .map((f) => f.id);
    setSelectedIds(new Set(initial));
    setVerdict(null);
    setBody("");
    setPostedReviewId(null);
    setErrorMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard dismiss (SPEC-04 non-functional accessibility).
  // Active only while open; cleaned up when open → false or unmount.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // AC-1: render nothing when closed (no DOM overhead).
  if (!open) return null;

  // ---- Helpers ----

  const toggleFinding = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Pre-selected findings appear first (stable sort — order does not change
  // as the user toggles checkboxes, only when allFindings itself changes).
  const sortedFindings = [...allFindings].sort((a, b) => {
    const aWeight = a.accepted_at !== null && a.dismissed_at === null ? 0 : 1;
    const bWeight = b.accepted_at !== null && b.dismissed_at === null ? 0 : 1;
    return aWeight - bWeight;
  });

  const handlePost = () => {
    if (!verdict) return;
    setErrorMsg(null);
    mutation.mutate(
      { verdict, body, finding_ids: [...selectedIds] },
      {
        onSuccess: (data) => {
          setPostedReviewId(data.github_review_id);
        },
        onError: (err) => {
          // ApiError (and test stubs) carry an optional `code` property.
          const code = (err as { code?: string }).code;
          setErrorMsg(
            code === "github_unavailable" ? t("errorGithubUnavailable") : err.message,
          );
        },
      },
    );
  };

  // ---- Render ----

  return (
    <Drawer
      width={560}
      title={t("title")}
      subtitle={t("subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            disabled={verdict === null || mutation.isPending || !!postedReviewId}
            onClick={handlePost}
          >
            {mutation.isPending ? t("posting") : t("post")}
          </Button>
        </div>
      }
    >
      {/* Verdict selector (AC-3) */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          {t("verdictLabel")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const).map((v) => {
            const label =
              v === "APPROVE"
                ? t("verdicts.approve")
                : v === "COMMENT"
                  ? t("verdicts.comment")
                  : t("verdicts.requestChanges");
            return (
              <button
                key={v}
                onClick={() => setVerdict(v)}
                aria-pressed={verdict === v}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border:
                    verdict === v
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border-strong)",
                  background:
                    verdict === v ? "var(--accent-bg, var(--bg-elevated))" : "var(--bg-elevated)",
                  color:
                    verdict === v ? "var(--accent-text, var(--text-primary))" : "var(--text-primary)",
                  fontWeight: verdict === v ? 600 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Review body (AC-4) */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <label
            htmlFor="compose-review-body"
            style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}
          >
            {t("reviewBody")}
          </label>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {t("markdownEditable")}
          </span>
        </div>
        <textarea
          id="compose-review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 13,
            color: "var(--text-primary)",
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Inline comments counter (AC-7) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          {t("inlineComments")}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("findingsCount", { count: selectedIds.size })}
        </span>
      </div>

      {/* Findings list (AC-5, AC-6) */}
      {sortedFindings.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: 20,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {sortedFindings.map((f) => (
            <label
              key={f.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(f.id)}
                onChange={() => toggleFinding(f.id)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ color: "var(--text-primary)" }}>{f.title}</span>
                <span
                  style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}
                >
                  {f.file}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Success message (AC-10, AC-11) */}
      {postedReviewId && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            marginBottom: 16,
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          {mutation.data?.omitted_count && mutation.data.omitted_count > 0
            ? t("postedWithOmissions", {
                id: postedReviewId,
                count: mutation.data.omitted_count,
              })
            : t("postedWithId", { id: postedReviewId })}
        </div>
      )}

      {/* Error message (AC-12, AC-13) */}
      {errorMsg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "var(--crit-bg, rgba(255,0,0,0.08))",
            border: "1px solid var(--crit, #e53e3e)",
            marginBottom: 16,
            fontSize: 13,
            color: "var(--crit, #e53e3e)",
          }}
        >
          {errorMsg}
        </div>
      )}
    </Drawer>
  );
}
