"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { usePrIntent, useReclassifyIntent } from "../../../../../../../lib/hooks/reviews";
import { s } from "./styles";

interface IntentCardProps {
  prId: string;
}

export function IntentCard({ prId }: IntentCardProps) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const reclassify = useReclassifyIntent(prId);

  if (isLoading) return null;
  if (!intent) return null;

  const savedK = intent.savedTokensEstimate
    ? `~${(intent.savedTokensEstimate / 1000).toFixed(1)}K`
    : null;

  return (
    <section>
      <SectionLabel icon="Target">Intent</SectionLabel>
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.summary}>&ldquo;{intent.intent}&rdquo;</span>
          <button
            style={s.recalcBtn}
            onClick={() => reclassify.mutate()}
            disabled={reclassify.isPending}
          >
            {reclassify.isPending ? "Classifying…" : "Recalculate"}
          </button>
        </div>

        <div style={s.columns}>
          <div style={s.column}>
            <div style={s.columnLabel}>✓ In scope</div>
            {intent.in_scope.map((item, i) => (
              <div key={i} style={s.item}>
                <span style={s.bullet}>•</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div style={s.column}>
            <div style={s.columnLabel}>✗ Out of scope</div>
            {intent.out_of_scope.map((item, i) => (
              <div key={i} style={s.item}>
                <span style={s.bullet}>•</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          {intent.risk_areas.length > 0 && (
            <div style={s.column}>
              <div style={s.columnLabel}>⚠ Risk areas</div>
              {intent.risk_areas.map((item, i) => (
                <div key={i} style={s.item}>
                  <span style={s.bullet}>•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {(intent.classifierModel || savedK) && (
          <div style={s.footer}>
            {intent.classifierModel && <span>{intent.classifierModel}</span>}
            {savedK && <span>· saved {savedK} tokens vs full diff</span>}
          </div>
        )}
      </div>
    </section>
  );
}
