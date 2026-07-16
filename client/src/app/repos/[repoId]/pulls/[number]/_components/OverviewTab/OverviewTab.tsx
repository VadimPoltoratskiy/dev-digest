"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { PrBriefCard } from "../PrBriefCard";
import { ReadThisFirstCard } from "./_components/ReadThisFirstCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
      {prId && <IntentCard prId={prId} />}
      {prId && <PrBriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />}
      {prId && <ReadThisFirstCard prId={prId} />}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
