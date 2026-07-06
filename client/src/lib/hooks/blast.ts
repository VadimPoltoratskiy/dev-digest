/* hooks/blast.ts — React Query hook for the Blast Radius feature.
   Reads GET /pulls/:id/blast, which serves the ready-made repo-intel index
   (no model call). See server/src/modules/blast/. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type { BlastExplanation, BlastRadius } from "@devdigest/shared";

/** Blast radius for a PR: changed symbols → callers → affected endpoints/crons. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery<BlastRadius>({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** Cached AI explanation of the blast radius, or null if none generated yet. */
export function useBlastExplanation(prId: string | null | undefined) {
  return useQuery<BlastExplanation | null>({
    queryKey: ["blast-explanation", prId],
    queryFn: () => api.get<BlastExplanation | null>(`/pulls/${prId}/blast/explanation`),
    enabled: !!prId,
  });
}

/** POST /pulls/:id/blast/explain — the one on-demand LLM call. */
export function useExplainBlast(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<BlastExplanation, Error>({
    mutationFn: () => api.post<BlastExplanation>(`/pulls/${prId}/blast/explain`, {}),
    onSuccess: (data) => {
      qc.setQueryData(["blast-explanation", prId], data);
    },
    onError: (err) => notify.error(`Blast explanation failed: ${err.message}`),
  });
}
