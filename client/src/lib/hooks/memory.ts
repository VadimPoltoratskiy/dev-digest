/* hooks/memory.ts — React Query hooks for the Memory feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMemory,
  createMemory,
  patchMemory,
  deleteMemory,
  type MemoryParams,
} from "../api";
import type { MemoryItem } from "@devdigest/shared";

export type { MemoryParams };

export function useMemory(filters: MemoryParams = {}) {
  const params: MemoryParams = {};
  if (filters.scope) params.scope = filters.scope;
  if (filters.kind) params.kind = filters.kind;
  if (filters.repo) params.repo = filters.repo;
  if (filters.freshness) params.freshness = filters.freshness;
  if (filters.q) params.q = filters.q;

  return useQuery({
    queryKey: ["memory", params],
    queryFn: () => fetchMemory(params),
  });
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<MemoryItem> & { repo?: string }) =>
      createMemory(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

export interface PatchMemoryInput {
  id: string;
  body: Partial<MemoryItem>;
}

export function usePatchMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: PatchMemoryInput) => patchMemory(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
    },
  });
}
