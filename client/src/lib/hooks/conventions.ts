/* hooks/conventions.ts — React Query hooks for the Conventions Extractor feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(["conventions", repoId], data);
    },
  });
}

export interface UpdateConventionInput {
  convId: string;
  patch: { accepted?: boolean; rule?: string };
}

export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ convId, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${convId}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (prev) =>
        prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
      );
    },
  });
}

export function useDeleteConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (convId: string) => api.del<void>(`/conventions/${convId}`),
    onSuccess: (_, convId) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (prev) =>
        prev ? prev.filter((c) => c.id !== convId) : prev,
      );
    },
  });
}

export function useConventionsToSkill() {
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<Skill>(`/repos/${repoId}/conventions/to-skill`),
  });
}
