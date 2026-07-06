"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";

/**
 * Read-only preview of a Project Context document's raw markdown. Shared
 * between the /context page and the agent/skill editor Context tabs.
 */
export function DocPreviewModal({ doc, onClose }: { doc: SpecFile; onClose: () => void }) {
  const t = useTranslations("context");
  return (
    <Modal title={doc.path} subtitle={t("previewSubtitle")} onClose={onClose}>
      <pre
        style={{
          margin: 0,
          padding: "18px 24px",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {doc.content ?? ""}
      </pre>
    </Modal>
  );
}
