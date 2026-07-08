/* hooks/why.ts — React Query hook for the git-why blame drawer (SPEC-04).
   Reads GET /pulls/:id/why?file&line — a pure read, no mutation, no LLM call. */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { WhyTimeline } from "@devdigest/shared";
import { fetchWhyTimeline } from "../api";

/** WhyTimeline for a given file/line, or undefined until all three are set. */
export function useWhyTimeline(
  prId: string | null | undefined,
  file: string | null | undefined,
  line: number | null | undefined,
) {
  return useQuery<WhyTimeline>({
    queryKey: ["why-timeline", prId, file, line],
    queryFn: () => fetchWhyTimeline(prId!, file!, line!),
    enabled: !!prId && !!file && line != null,
  });
}
