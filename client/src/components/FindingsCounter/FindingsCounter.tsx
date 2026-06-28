"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { Severity } from "@devdigest/ui";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";

type FindingsSummary = {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
};

type SeverityKey = keyof FindingsSummary;
const SEV_ORDER: SeverityKey[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Pick findings from the latest review batch (newest createdAt within 5 min). */
function latestBatchFindings(reviews: ReviewRecord[]): FindingRecord[] {
  const reviewOnly = reviews.filter((r) => r.kind === "review" && r.findings.length > 0);
  if (reviewOnly.length === 0) return [];
  const latestMs = Math.max(...reviewOnly.map((r) => Date.parse(r.created_at)));
  const WINDOW_MS = 5 * 60 * 1000;
  return reviewOnly
    .filter((r) => latestMs - Date.parse(r.created_at) <= WINDOW_MS)
    .flatMap((r) => r.findings)
    .filter((f) => !f.dismissed_at);
}

function SevBadge({ severity, count }: { severity: SeverityKey; count: number }) {
  if (count === 0) return null;
  return <SeverityBadge severity={severity as Severity} count={count} compact />;
}

function FindingRow({ f }: { f: FindingRecord }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0 }}>
          {f.title}
        </span>
        <CategoryTag category={f.category as "bug" | "security" | "perf" | "style" | "test"} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {f.file}:{f.start_line}
        </span>
        <ConfidenceNum value={f.confidence} />
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          margin: 0,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {f.rationale.split("\n")[0]}
      </p>
    </div>
  );
}

export function FindingsCounter({
  summary,
  prId,
}: {
  summary: FindingsSummary | null | undefined;
  prId: string | null | undefined;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  // triggerRef: used to compute portal position from getBoundingClientRect.
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const { data: reviews, isLoading } = usePrReviews(open ? prId : null);

  // Close on click outside (checks both trigger and portal content).
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasAny = summary && (summary.CRITICAL > 0 || summary.WARNING > 0 || summary.SUGGESTION > 0);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasAny || !prId) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen((o) => !o);
  };

  const findings = reviews ? latestBatchFindings(reviews) : [];
  const totalCount = summary ? summary.CRITICAL + summary.WARNING + summary.SUGGESTION : 0;
  const MAX_SHOWN = 6;

  const popover = open && hasAny ? (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 360,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-modal)",
        zIndex: 9999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 8px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          {isLoading
            ? t("list.findings.loading")
            : t("list.findings.popoverTitle", { count: totalCount })}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}
        >
          <Icon.X size={14} />
        </button>
      </div>

      <div style={{ padding: "0 14px", maxHeight: 360, overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ padding: "20px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
            {t("list.findings.loading")}
          </div>
        ) : findings.length === 0 ? (
          <div style={{ padding: "20px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
            {t("list.findings.none")}
          </div>
        ) : (
          <>
            {findings.slice(0, MAX_SHOWN).map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
            {findings.length > MAX_SHOWN && (
              <div style={{ padding: "8px 0", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                {t("list.findings.andMore", { count: findings.length - MAX_SHOWN })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={triggerRef}
        role={hasAny && prId ? "button" : undefined}
        tabIndex={hasAny && prId ? 0 : undefined}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick(e as unknown as React.MouseEvent);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: hasAny && prId ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {hasAny ? (
          SEV_ORDER.map((sev) => (
            <SevBadge key={sev} severity={sev} count={summary![sev]} />
          ))
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>
        )}
      </div>
      {typeof document !== "undefined" && popover ? createPortal(popover, document.body) : null}
    </>
  );
}
