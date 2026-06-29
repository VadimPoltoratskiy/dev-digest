"use client";

import React from "react";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

export function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div style={{ padding: "20px" }}>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: 16,
          fontStyle: "italic",
        }}
      >
        Rendered as the reviewing agent receives it.
      </p>
      <Markdown>{skill.body}</Markdown>
    </div>
  );
}
