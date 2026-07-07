/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Onboarding } from "@devdigest/shared";
import { fetchOnboardingTour, generateOnboardingTour } from "../api";

type OnboardingTourData = Onboarding & { generatedAt: string };
type OnboardingGenerateResponse = Onboarding & { generatedAt: string; degraded?: boolean };

/**
 * Fetches the cached onboarding tour for a repo.
 * Returns 404 ApiError (status 404) when no tour has been generated yet —
 * components differentiate this from real errors to show the Generate CTA.
 */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery<OnboardingTourData>({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => fetchOnboardingTour(repoId!),
    enabled: !!repoId,
  });
}

/**
 * Triggers onboarding tour generation (POST /repos/:repoId/onboarding).
 * On success, writes the result into the tour query cache.
 * On 503 code === 'no_llm_key', `error` is an ApiError the component renders
 * as a Settings notice — not an error boundary.
 */
export function useGenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<OnboardingGenerateResponse, Error>({
    mutationFn: () => generateOnboardingTour(repoId!),
    onSuccess: (data) => {
      qc.setQueryData(["onboarding-tour", repoId], data);
    },
  });
}
