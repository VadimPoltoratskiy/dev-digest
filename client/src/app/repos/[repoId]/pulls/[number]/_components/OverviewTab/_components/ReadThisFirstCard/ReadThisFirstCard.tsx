"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import { ReviewFocusItem } from "./_components/ReviewFocusItem";
import { s } from "./styles";

interface ReadThisFirstCardProps {
  prId: string;
}

/**
 * Standalone "Read This First" block on the Overview tab. Surfaces the brief's
 * ordered `review_focus` list — the prioritized reading list — as its own
 * top-level section, rather than burying it inside the brief card.
 *
 * Reads the brief via `usePrBrief(prId)` — the same query key the brief card
 * already uses, so TanStack Query serves both from one cached request. Renders
 * nothing while loading, when no brief exists, or when `review_focus` is empty.
 */
export function ReadThisFirstCard({ prId }: ReadThisFirstCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);

  if (isLoading || !data || data.review_focus.length === 0) return null;

  return (
    <section>
      <SectionLabel icon="Eye">{t("block.readThisFirst")}</SectionLabel>
      <div style={s.card}>
        <ul style={s.list}>
          {data.review_focus.map((item) => (
            <ReviewFocusItem key={item} prId={prId} path={item} />
          ))}
        </ul>
      </div>
    </section>
  );
}
