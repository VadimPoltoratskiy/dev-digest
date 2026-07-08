/* hooks/brief.ts — React Query hooks for the PR Brief feature.
   Reads GET /pulls/:id/brief (returns null on 404) and
   POSTs to POST /pulls/:id/brief with optional force flag. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Brief, BriefTimeline } from "@devdigest/shared";
import { fetchPrBrief, generateBrief, fetchBriefHistory } from "../api";
import { notify } from "../toast";

/** Cached PR brief, or null if none generated yet. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery<Brief | null>({
    queryKey: ["pr-brief", prId],
    queryFn: () => fetchPrBrief(prId!),
    enabled: !!prId,
  });
}

/** BriefTimeline — every generated brief for this PR, newest first. */
export function useBriefHistory(prId: string | null | undefined) {
  return useQuery<BriefTimeline>({
    queryKey: ["pr-brief-history", prId],
    queryFn: () => fetchBriefHistory(prId!),
    enabled: !!prId,
  });
}

/** POST /pulls/:id/brief — generate or force-regenerate a PR brief. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<Brief, Error, { force?: boolean } | undefined>({
    mutationFn: (opts) => generateBrief(prId!, opts),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
      // A fresh generation adds/updates a BriefTimeline entry — refetch history.
      qc.invalidateQueries({ queryKey: ["pr-brief-history", prId] });
    },
    onError: (err) => notify.error(`Brief generation failed: ${err.message}`),
  });
}
