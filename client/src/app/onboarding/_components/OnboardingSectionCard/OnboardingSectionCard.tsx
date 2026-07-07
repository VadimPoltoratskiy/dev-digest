"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "../../../../components/mermaid-diagram";

/**
 * Renders a single onboarding tour section with an <h2> heading, markdown
 * body, an optional mermaid diagram, and an optional list of related file paths.
 */
export function OnboardingSectionCard({ section }: { section: OnboardingSection }) {
  const t = useTranslations("onboarding");

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {section.title}
      </h2>

      <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        <Markdown>{section.body}</Markdown>
      </div>

      {section.diagram != null && (
        <MermaidDiagram
          chart={section.diagram}
          alt={`${section.title} diagram`}
        />
      )}

      {section.links.length > 0 && (
        <div>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {t("relatedFiles")}
          </p>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 16px",
              listStyle: "disc",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {section.links.map((link) => (
              <li key={link.path} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                <code
                  style={{
                    fontSize: "0.92em",
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "var(--bg-hover)",
                    color: "var(--accent-text)",
                  }}
                >
                  {link.path}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
