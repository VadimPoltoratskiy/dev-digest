/* hooks/pr-files.ts — React Query hooks for PR file-history lookups (SPEC-06).
   Reads GET /pulls/:id/files/prior-prs?path=<path> — pure read, no mutation. */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { PriorPrList } from "@devdigest/shared";
import { fetchPriorPrs } from "../api";

/**
 * Prior PRs that touched a given file path in the same repo.
 * No request fires until enabled=true (i.e., until the ReviewFocusItem is
 * first expanded). TanStack Query caches under (prId, path) — no re-fetch
 * on subsequent expands of the same item (AC-6 lazy fetch + cache behaviour).
 */
export function usePriorPrs(
  prId: string | null | undefined,
  path: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<PriorPrList>({
    queryKey: ["prior-prs", prId, path],
    queryFn:  () => fetchPriorPrs(prId!, path!),
    enabled:  !!prId && !!path && enabled,
  });
}
