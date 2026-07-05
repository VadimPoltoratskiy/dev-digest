/* hooks/blast.ts — React Query hook for the Blast Radius feature.
   Reads GET /pulls/:id/blast, which serves the ready-made repo-intel index
   (no model call). See server/src/modules/blast/. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/** Blast radius for a PR: changed symbols → callers → affected endpoints/crons. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery<BlastRadius>({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
